/**
 * ShadowResolvePass - three-geospatial shadowResolve.frag 的 Cesium 适配版：
 * - 输入：BSM atlas (rgba) + depthVelocity atlas (r=depth, g=velx(px), b=vely(px))
 * - 输出：时间域解析后的 BSM atlas（variance clipping + temporalAlpha）
 */
export class ShadowResolvePass {
    constructor(viewer, options = {}) {
        this.viewer = viewer;
        this.size = options.size || 1024;
        this.temporalAlpha = options.temporalAlpha ?? 0.1;
        this.varianceGamma = options.varianceGamma ?? 1.0;
        this._gl = null;
        this._program = null;
        this._fbo = null;
        this._outTex = null;
        this._historyTex = null;
        this._useFloatRT = true;
        this._preRenderListener = null;
        this.inputTexture = null;
        this.depthVelocityTexture = null;
    }

    setInputTextures(inputTexture, depthVelocityTexture) {
        this.inputTexture = inputTexture;
        this.depthVelocityTexture = depthVelocityTexture;
    }

    getTexture() {
        // 每帧 render() 末尾做了 swap：刚写入的是 _historyTex。Cesium 仅支持 sampler2D，故返回 2D 纹理。
        if (!this._gl || !this._outTex || !this._historyTex) return null;
        return { _texture: this._historyTex, _textureTarget: this._gl.TEXTURE_2D, _target: this._gl.TEXTURE_2D };
    }

    _createTexture() {
        const gl = this._gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (this._useFloatRT) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.size, this.size, 0, gl.RGBA, gl.HALF_FLOAT, null);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.size, this.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return tex;
    }

    createRT() {
        const gl = this._gl;
        if (!gl) return;

        gl.getExtension("EXT_color_buffer_float");
        gl.getExtension("OES_texture_half_float_linear");

        // 粗略探测 float FBO 可用性
        this._useFloatRT = true;
        const test = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, test);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
        } catch (e) {
            this._useFloatRT = false;
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.deleteTexture(test);

        if (this._outTex) gl.deleteTexture(this._outTex);
        if (this._historyTex) gl.deleteTexture(this._historyTex);
        if (this._fbo) gl.deleteFramebuffer(this._fbo);

        this._outTex = this._createTexture();
        this._historyTex = this._createTexture();

        this._fbo = gl.createFramebuffer();
    }

    getVertexShader() {
        return `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;
    }

    getFragmentShader() {
        return `#version 300 es
precision highp float;

uniform sampler2D u_inputBuffer;
uniform sampler2D u_depthVelocityBuffer;
uniform sampler2D u_historyBuffer;

uniform vec2 u_texelSize;
uniform float u_varianceGamma;
uniform float u_temporalAlpha;

in vec2 v_uv;
out vec4 out_color;

vec4 clipAABB(const vec4 current, const vec4 history, const vec4 minColor, const vec4 maxColor) {
  vec3 pClip = 0.5 * (maxColor.rgb + minColor.rgb);
  vec3 eClip = 0.5 * (maxColor.rgb - minColor.rgb) + 1e-7;
  vec4 vClip = history - vec4(pClip, current.a);
  vec3 vUnit = vClip.xyz / eClip;
  vec3 aUnit = abs(vUnit);
  float maUnit = max(aUnit.x, max(aUnit.y, aUnit.z));
  if (maUnit > 1.0) {
    return vec4(pClip, current.a) + vClip / maUnit;
  }
  return history;
}

#define ACCUMULATE_VARIANCE(buf, coord, ox, oy) { \
  vec4 n = textureOffset(buf, coord, ivec2(ox, oy)); \
  moment1 += n; moment2 += n * n; }

vec4 varianceClipping(const sampler2D inputBuffer, const vec2 coord, const vec4 current, const vec4 history, const float gamma) {
  vec4 moment1 = current;
  vec4 moment2 = current * current;
  ACCUMULATE_VARIANCE(inputBuffer, coord, -1, -1)
  ACCUMULATE_VARIANCE(inputBuffer, coord, -1,  1)
  ACCUMULATE_VARIANCE(inputBuffer, coord,  1, -1)
  ACCUMULATE_VARIANCE(inputBuffer, coord,  1,  1)
  ACCUMULATE_VARIANCE(inputBuffer, coord,  1,  0)
  ACCUMULATE_VARIANCE(inputBuffer, coord,  0, -1)
  ACCUMULATE_VARIANCE(inputBuffer, coord,  0,  1)
  ACCUMULATE_VARIANCE(inputBuffer, coord, -1,  0)
  const float N = 9.0;
  vec4 mean = moment1 / N;
  vec4 vg = sqrt(max(moment2 / N - mean * mean, 0.0)) * gamma;
  vec4 minColor = mean - vg;
  vec4 maxColor = mean + vg;
  return clipAABB(clamp(mean, minColor, maxColor), history, minColor, maxColor);
}

#define CHECK_CLOSEST(buf, coord, ox, oy) { \
  vec4 n = texelFetchOffset(buf, coord, 0, ivec2(ox, oy)); \
  if (n.r < result.r) result = n; }

vec4 getClosestFragment() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 result = texelFetch(u_depthVelocityBuffer, coord, 0);
  CHECK_CLOSEST(u_depthVelocityBuffer, coord, -1, -1)
  CHECK_CLOSEST(u_depthVelocityBuffer, coord, -1,  0)
  CHECK_CLOSEST(u_depthVelocityBuffer, coord, -1,  1)
  CHECK_CLOSEST(u_depthVelocityBuffer, coord,  0, -1)
  CHECK_CLOSEST(u_depthVelocityBuffer, coord,  0,  1)
  CHECK_CLOSEST(u_depthVelocityBuffer, coord,  1, -1)
  CHECK_CLOSEST(u_depthVelocityBuffer, coord,  1,  0)
  CHECK_CLOSEST(u_depthVelocityBuffer, coord,  1,  1)
  return result;
}

void main() {
  vec4 current = texture(u_inputBuffer, v_uv);
  vec4 depthVelocity = getClosestFragment();
  vec2 velocityUv = depthVelocity.gb * u_texelSize;
  vec2 prevUv = v_uv - velocityUv;
  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
    out_color = current;
    return;
  }
  vec4 history = texture(u_historyBuffer, prevUv);
  vec4 clipped = varianceClipping(u_inputBuffer, v_uv, current, history, u_varianceGamma);
  out_color = mix(clipped, current, u_temporalAlpha);
}
`;
    }

    createProgram() {
        const gl = this._gl;
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, this.getVertexShader());
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error("ShadowResolvePass VS:", gl.getShaderInfoLog(vs));
            gl.deleteShader(vs);
            return;
        }
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, this.getFragmentShader());
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error("ShadowResolvePass FS:", gl.getShaderInfoLog(fs));
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return;
        }
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("ShadowResolvePass link:", gl.getProgramInfoLog(prog));
            gl.deleteProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this._program = prog;
    }

    render() {
        const gl = this._gl;
        if (!gl || !this._fbo || !this._program || !this._outTex || !this._historyTex) return;
        if (!this.inputTexture || !this.depthVelocityTexture) return;

        const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevViewport = gl.getParameter(gl.VIEWPORT);
        const prevBlend = gl.isEnabled(gl.BLEND);
        const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._outTex, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.viewport(0, 0, this.size, this.size);
        gl.useProgram(this._program);

        const texelSizeLoc = gl.getUniformLocation(this._program, "u_texelSize");
        if (texelSizeLoc) gl.uniform2f(texelSizeLoc, 1.0 / this.size, 1.0 / this.size);
        const vgLoc = gl.getUniformLocation(this._program, "u_varianceGamma");
        if (vgLoc) gl.uniform1f(vgLoc, this.varianceGamma);
        const taLoc = gl.getUniformLocation(this._program, "u_temporalAlpha");
        if (taLoc) gl.uniform1f(taLoc, this.temporalAlpha);

        let unit = 0;
        const bind = (name, texObj) => {
            const loc = gl.getUniformLocation(this._program, name);
            if (loc === null) return;
            gl.uniform1i(loc, unit);
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, texObj._texture ?? texObj);
            unit++;
        };
        bind("u_inputBuffer", this.inputTexture);
        bind("u_depthVelocityBuffer", this.depthVelocityTexture);
        bind("u_historyBuffer", { _texture: this._historyTex });

        const posLoc = gl.getAttribLocation(this._program, "a_position");
        if (posLoc >= 0) {
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.disableVertexAttribArray(posLoc);
            gl.deleteBuffer(buf);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
        if (prevBlend) gl.enable(gl.BLEND);
        if (prevDepthTest) gl.enable(gl.DEPTH_TEST);

        // swap out/history
        const tmp = this._historyTex;
        this._historyTex = this._outTex;
        this._outTex = tmp;
    }

    init() {
        const scene = this.viewer.scene;
        const gl = scene.context._gl;
        if (!gl) return;
        this._gl = gl;
        this.createRT();
        this.createProgram();
        this._preRenderListener = scene.preRender.addEventListener(() => this.render());
    }

    destroy() {
        if (this._preRenderListener) {
            this._preRenderListener();
            this._preRenderListener = null;
        }
        const gl = this._gl;
        if (gl) {
            if (this._program) gl.deleteProgram(this._program);
            if (this._outTex) gl.deleteTexture(this._outTex);
            if (this._historyTex) gl.deleteTexture(this._historyTex);
            if (this._fbo) gl.deleteFramebuffer(this._fbo);
        }
        this._program = null;
        this._outTex = null;
        this._historyTex = null;
        this._fbo = null;
        this._gl = null;
    }
}

