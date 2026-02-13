/**
 * VRM Manager - Fixed arm system
 * KEY FIX: Uses NORMALIZED bones set BEFORE vrm.update()
 * vrm.update() copies normalized → raw, so we control normalized bones
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export class VRMManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.vrm = null;
        this.clock = new THREE.Clock();
        this.isLoaded = false;
        this.isSpeaking = false;

        // Blink
        this.blinkTimer = 0;
        this.nextBlinkTime = 3 + Math.random() * 4;
        this.doubleBlink = false;

        // Breathing
        this.breathTimer = 0;

        // Lip sync
        this.mouthVal = 0;
        this.mouthTarget = 0;

        // Head (additive, applied after vrm.update to raw bones)
        this.headTimer = 0;
        this.headTX = 0; this.headTY = 0; this.headTZ = 0;
        this.headCX = 0; this.headCY = 0; this.headCZ = 0;
        this.nextHeadTime = 2 + Math.random() * 3;

        // Eyes
        this.eyeTimer = 0;
        this.eyeTX = 0; this.eyeTY = 0;
        this.eyeCX = 0; this.eyeCY = 0;
        this.nextEyeTime = 1 + Math.random() * 2;

        // Expressions
        this.exprTimer = 0;
        this.nextExprTime = 8 + Math.random() * 12;
        this.curExpr = null;
        this.exprVal = 0;

        // Body sway
        this.swayTimer = 0;

        // === ARM GESTURE SYSTEM (normalized bones) ===
        this.armReady = false;

        // Current quaternion state for each arm bone (what we set each frame)
        this._armQ = {
            leftUpperArm: new THREE.Quaternion(),
            rightUpperArm: new THREE.Quaternion(),
            leftLowerArm: new THREE.Quaternion(),
            rightLowerArm: new THREE.Quaternion(),
            leftHand: new THREE.Quaternion(),
            rightHand: new THREE.Quaternion(),
        };

        // Rest pose quaternions (natural arms down)
        this._restQ = {};

        // Target quaternions for gesture
        this._goalQ = {};

        this.gestureTimer = 0;
        this.nextGestureTime = 0.5;

        this._init();
    }

    _init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a1a);

        this.camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 1.35, 1.8);
        this.camera.lookAt(0, 1.2, 0);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        this.scene.add(new THREE.AmbientLight(0x404060, 1.5));
        const m = new THREE.DirectionalLight(0xe0e8ff, 2); m.position.set(2, 3, 3); this.scene.add(m);
        const f = new THREE.DirectionalLight(0x00e5ff, 0.5); f.position.set(-2, 1, 2); this.scene.add(f);
        const r = new THREE.DirectionalLight(0x7c4dff, 0.4); r.position.set(0, 2, -3); this.scene.add(r);
        const g = new THREE.PointLight(0x00e5ff, 0.3, 5); g.position.set(0, 0, 1); this.scene.add(g);

        const c = new THREE.Mesh(
            new THREE.CircleGeometry(1, 64),
            new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.06 })
        );
        c.rotation.x = -Math.PI / 2; c.position.y = 0.01; this.scene.add(c);

        window.addEventListener('resize', () => this._onResize());
        this._animate();
    }

    async loadModel(url) {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        return new Promise((resolve, reject) => {
            loader.load(url,
                (gltf) => {
                    const vrm = gltf.userData.vrm;
                    if (!vrm) { reject(new Error('No VRM')); return; }
                    if (this.vrm) { this.scene.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); }
                    this.vrm = vrm;
                    VRMUtils.rotateVRM0(vrm);
                    this.scene.add(vrm.scene);
                    this._buildRestPose();
                    this._fitCamera();
                    this.isLoaded = true;
                    this.armReady = true;
                    resolve(vrm);
                },
                () => { },
                (err) => reject(err)
            );
        });
    }

    async loadModelFromFile(file) {
        const url = URL.createObjectURL(file);
        try { await this.loadModel(url); } finally { URL.revokeObjectURL(url); }
    }

    // Build natural rest pose for arms (quaternions for normalized bones)
    // Empirically verified: for this VRM model:
    //   Left arm: NEGATIVE Z = DOWN, positive Z = UP
    //   Right arm: POSITIVE Z = DOWN, negative Z = UP
    _buildRestPose() {
        const e = new THREE.Euler();

        // Left upper arm: NEGATIVE Z to rotate DOWN
        e.set(0.1, 0, -0.85, 'XYZ');
        this._restQ.leftUpperArm = new THREE.Quaternion().setFromEuler(e);

        // Right upper arm: POSITIVE Z to rotate DOWN 
        e.set(0.1, 0, 0.85, 'XYZ');
        this._restQ.rightUpperArm = new THREE.Quaternion().setFromEuler(e);

        // Left lower arm: slight elbow bend
        e.set(0, 0.25, 0, 'XYZ');
        this._restQ.leftLowerArm = new THREE.Quaternion().setFromEuler(e);

        // Right lower arm: mirror
        e.set(0, -0.25, 0, 'XYZ');
        this._restQ.rightLowerArm = new THREE.Quaternion().setFromEuler(e);

        // Hands: relaxed
        e.set(0.05, 0, 0, 'XYZ');
        this._restQ.leftHand = new THREE.Quaternion().setFromEuler(e);
        this._restQ.rightHand = new THREE.Quaternion().setFromEuler(e);

        // Initialize current and goal to rest
        for (const key of Object.keys(this._restQ)) {
            this._armQ[key] = this._restQ[key].clone();
            this._goalQ[key] = this._restQ[key].clone();
        }

        console.log('✅ Arms DOWN rest pose built');
    }

    _fitCamera() {
        this.camera.position.set(0, 1.35, 1.8);
        this.camera.lookAt(0, 1.2, 0);
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ===== ANIMATION LOOP =====
    _animate() {
        requestAnimationFrame(() => this._animate());
        const delta = this.clock.getDelta();

        if (this.vrm) {
            // 1) Update expressions (before vrm.update)
            this._updateBlink(delta);
            this._updateLipSync(delta);
            this._updateMicroExpressions(delta);

            // 2) Set arm normalized bones BEFORE vrm.update
            this._updateArmGestures(delta);
            this._applyArmsToNormalized();

            // 3) VRM update: copies normalized → raw
            this.vrm.update(delta);

            // 4) Additive adjustments to RAW bones (head, eyes, sway)
            this._updateBreathing(delta);
            this._updateHead(delta);
            this._updateEyes(delta);
            this._updateBodySway(delta);
        }

        this.renderer.render(this.scene, this.camera);
    }

    // Write current arm quaternions to normalized bone nodes
    _applyArmsToNormalized() {
        if (!this.armReady || !this.vrm?.humanoid) return;

        for (const [name, quat] of Object.entries(this._armQ)) {
            try {
                const bone = this.vrm.humanoid.getNormalizedBoneNode(name);
                if (bone) {
                    bone.quaternion.copy(quat);
                }
            } catch (e) { }
        }
    }

    // ===== ARM GESTURE SYSTEM =====
    _updateArmGestures(delta) {
        if (!this.armReady) return;

        this.gestureTimer += delta;

        if (this.isSpeaking) {
            // Pick new speaking gesture
            if (this.gestureTimer > this.nextGestureTime) {
                this.gestureTimer = 0;
                this.nextGestureTime = 1.0 + Math.random() * 1.5;
                this._pickGesture();
            }
        } else {
            // Idle micro-motion
            this._setIdleGoal();
        }

        // Slerp current arm quaternions toward goal
        const speed = this.isSpeaking ? 0.05 : 0.025;
        for (const key of Object.keys(this._armQ)) {
            if (this._goalQ[key]) {
                this._armQ[key].slerp(this._goalQ[key], speed);
            }
        }
    }

    _pickGesture() {
        const e = new THREE.Euler();
        // Z signs: left arm negative=down, right arm positive=down
        // Gestures raise arms PARTIALLY from rest (less negative Z = higher)
        const gestures = [
            // Right hand explaining (raise right arm from rest)
            {
                rightUpperArm: [0.25, 0.15, 0.4],   // less positive = higher from rest
                rightLowerArm: [0.2, -0.6, 0],
                rightHand: [0.3, 0, 0],
                leftUpperArm: null, leftLowerArm: null, leftHand: null,
            },
            // Left hand emphasizing
            {
                leftUpperArm: [0.2, -0.1, -0.4],    // less negative = higher from rest
                leftLowerArm: [0.15, 0.5, 0],
                leftHand: [0.2, 0, 0],
                rightUpperArm: null, rightLowerArm: null, rightHand: null,
            },
            // Both hands open
            {
                leftUpperArm: [0.15, -0.1, -0.45],
                leftLowerArm: [0.1, 0.4, 0],
                leftHand: [0.15, 0, 0],
                rightUpperArm: [0.15, 0.1, 0.45],
                rightLowerArm: [0.1, -0.4, 0],
                rightHand: [0.15, 0, 0],
            },
            // Right hand point
            {
                rightUpperArm: [0.3, 0.2, 0.35],
                rightLowerArm: [0.25, -0.7, 0],
                rightHand: [0.4, 0, 0.1],
                leftUpperArm: null, leftLowerArm: null, leftHand: null,
            },
            // Left hand to chest
            {
                leftUpperArm: [0.35, -0.25, -0.4],
                leftLowerArm: [0.2, 0.8, 0],
                leftHand: [0.1, 0, 0],
                rightUpperArm: null, rightLowerArm: null, rightHand: null,
            },
            // Shrug
            {
                leftUpperArm: [0.12, 0, -0.6],
                rightUpperArm: [0.12, 0, 0.6],
                leftLowerArm: [0.05, 0.35, 0],
                rightLowerArm: [0.05, -0.35, 0],
                leftHand: [0.1, 0, 0], rightHand: [0.1, 0, 0],
            },
            // Both hands together
            {
                leftUpperArm: [0.25, 0.1, -0.45],
                rightUpperArm: [0.25, -0.1, 0.45],
                leftLowerArm: [0.15, 0.55, 0],
                rightLowerArm: [0.15, -0.55, 0],
                leftHand: [0.2, 0, 0], rightHand: [0.2, 0, 0],
            },
            // Wave right
            {
                rightUpperArm: [0.15, 0.1, 0.3],
                rightLowerArm: [0.1, -0.4, 0],
                rightHand: [0.5, 0.15, 0],
                leftUpperArm: null, leftLowerArm: null, leftHand: null,
            },
        ];

        const g = gestures[Math.floor(Math.random() * gestures.length)];

        for (const [bone, val] of Object.entries(g)) {
            if (val === null) {
                this._goalQ[bone] = this._restQ[bone].clone();
            } else {
                e.set(val[0], val[1], val[2], 'XYZ');
                this._goalQ[bone] = new THREE.Quaternion().setFromEuler(e);
            }
        }
    }

    _setIdleGoal() {
        const t = this.swayTimer;

        for (const [bone, restQ] of Object.entries(this._restQ)) {
            // Tiny sinusoidal offsets for micro-fidgeting
            const ox = Math.sin(t * 0.3 + bone.length) * 0.008;
            const oy = Math.sin(t * 0.25 + bone.length * 2) * 0.006;
            const oz = Math.sin(t * 0.35 + bone.length * 3) * 0.008;

            const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(ox, oy, oz, 'XYZ'));
            this._goalQ[bone] = restQ.clone().multiply(offset);
        }
    }

    // ===== BLINK =====
    _updateBlink(delta) {
        if (!this.vrm?.expressionManager) return;
        this.blinkTimer += delta;
        if (this.blinkTimer > this.nextBlinkTime) {
            this.blinkTimer = 0;
            this.doubleBlink = Math.random() < 0.25;
            this._doBlink();
            this.nextBlinkTime = 2 + Math.random() * 5;
        }
    }

    _doBlink() {
        if (!this.vrm?.expressionManager) return;
        const ex = this.vrm.expressionManager;
        let p = 0;
        const iv = setInterval(() => {
            p += 0.18;
            if (p <= 0.5) ex.setValue('blink', p * 2);
            else if (p <= 1) ex.setValue('blink', (1 - p) * 2);
            else {
                ex.setValue('blink', 0); clearInterval(iv);
                if (this.doubleBlink) { this.doubleBlink = false; setTimeout(() => this._doBlink(), 120); }
            }
        }, 25);
    }

    // ===== BREATHING =====
    _updateBreathing(delta) {
        if (!this.vrm?.scene) return;
        this.breathTimer += delta;
        this.vrm.scene.position.y = Math.sin(this.breathTimer * 1.2) * 0.003;
    }

    // ===== LIP SYNC =====
    _updateLipSync(delta) {
        if (!this.vrm?.expressionManager) return;
        this.mouthVal += (this.mouthTarget - this.mouthVal) * 0.25;
        try {
            this.vrm.expressionManager.setValue('aa', this.mouthVal * 0.8);
            this.vrm.expressionManager.setValue('oh', this.mouthVal * 0.3);
        } catch (e) { }
    }

    // ===== HEAD (after vrm.update, additive to raw) =====
    _updateHead(delta) {
        this.headTimer += delta;
        if (this.headTimer > this.nextHeadTime) {
            this.headTimer = 0;
            this.nextHeadTime = 2 + Math.random() * 4;
            const s = this.isSpeaking ? 1.5 : 1;
            this.headTX = (Math.random() - 0.5) * 0.06 * s;
            this.headTY = (Math.random() - 0.5) * 0.1 * s;
            this.headTZ = (Math.random() - 0.5) * 0.03;
        }
        this.headCX += (this.headTX - this.headCX) * 0.03;
        this.headCY += (this.headTY - this.headCY) * 0.03;
        this.headCZ += (this.headTZ - this.headCZ) * 0.03;

        try {
            const head = this.vrm.humanoid.getRawBoneNode('head');
            if (head) {
                head.rotation.x += this.headCX;
                head.rotation.y += this.headCY;
                head.rotation.z += this.headCZ;
            }
        } catch (e) { }
    }

    // ===== EYES =====
    _updateEyes(delta) {
        this.eyeTimer += delta;
        if (this.eyeTimer > this.nextEyeTime) {
            this.eyeTimer = 0;
            this.nextEyeTime = 0.8 + Math.random() * 2.5;
            if (this.isSpeaking && Math.random() < 0.7) {
                this.eyeTX = (Math.random() - 0.5) * 0.02;
                this.eyeTY = (Math.random() - 0.5) * 0.02;
            } else {
                const t = Math.random();
                if (t < 0.4) { this.eyeTX = (Math.random() - 0.5) * 0.02; this.eyeTY = (Math.random() - 0.5) * 0.02; }
                else { this.eyeTX = (Math.random() - 0.5) * 0.06; this.eyeTY = (Math.random() - 0.3) * 0.04; }
            }
        }
        this.eyeCX += (this.eyeTX - this.eyeCX) * 0.08;
        this.eyeCY += (this.eyeTY - this.eyeCY) * 0.08;

        try {
            const le = this.vrm.humanoid.getRawBoneNode('leftEye');
            const re = this.vrm.humanoid.getRawBoneNode('rightEye');
            if (le) { le.rotation.x += this.eyeCX; le.rotation.y += this.eyeCY; }
            if (re) { re.rotation.x += this.eyeCX; re.rotation.y += this.eyeCY; }
        } catch (e) { }
    }

    // ===== MICRO EXPRESSIONS =====
    _updateMicroExpressions(delta) {
        if (!this.vrm?.expressionManager) return;
        const ex = this.vrm.expressionManager;
        this.exprTimer += delta;
        if (this.exprTimer > this.nextExprTime) {
            this.exprTimer = 0;
            this.nextExprTime = 6 + Math.random() * 10;
            this.curExpr = ['relaxed', 'happy'][Math.floor(Math.random() * 2)];
        }
        if (this.curExpr) {
            if (this.exprTimer < 1) this.exprVal = Math.min(this.exprTimer * 0.25, 0.25);
            else if (this.exprTimer < 3) this.exprVal = 0.2 + Math.sin(this.exprTimer * 2) * 0.05;
            else if (this.exprTimer < 4) this.exprVal = Math.max(0, 0.25 * (4 - this.exprTimer));
            else { this.exprVal = 0; try { ex.setValue(this.curExpr, 0); } catch (er) { } this.curExpr = null; }
            if (this.curExpr) try { ex.setValue(this.curExpr, this.exprVal); } catch (er) { }
        }
    }

    // ===== BODY SWAY =====
    _updateBodySway(delta) {
        this.swayTimer += delta;
        try {
            const spine = this.vrm.humanoid.getRawBoneNode('spine');
            if (spine) {
                spine.rotation.z += Math.sin(this.swayTimer * 0.4) * 0.002;
                spine.rotation.x += Math.cos(this.swayTimer * 0.3) * 0.001;
            }
        } catch (e) { }
    }

    // ===== PUBLIC API =====

    startSpeaking() {
        this.isSpeaking = true;
        this.gestureTimer = 999;
        this._animateMouth();
    }

    stopSpeaking() {
        this.isSpeaking = false;
        this.mouthTarget = 0;
    }

    _animateMouth() {
        if (!this.isSpeaking) return;
        this.mouthTarget = [0.3 + Math.random() * 0.5, Math.random() * 0.15, 0.15 + Math.random() * 0.3][Math.floor(Math.random() * 3)];
        setTimeout(() => this._animateMouth(), 50 + Math.random() * 120);
    }

    setExpression(n, v = 1) { try { this.vrm?.expressionManager?.setValue(n, v); } catch (e) { } }
    resetExpressions() {
        ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'aa', 'oh'].forEach(n => {
            try { this.vrm?.expressionManager?.setValue(n, 0); } catch (e) { }
        });
    }

    showHappy() { this.resetExpressions(); this.setExpression('happy', 0.7); this.headTX = -0.06; setTimeout(() => { this.headTX = 0; }, 400); setTimeout(() => this.setExpression('happy', 0), 2500); }
    showSad() { this.resetExpressions(); this.setExpression('sad', 0.6); this.headTX = 0.05; setTimeout(() => { this.headTX = 0; this.setExpression('sad', 0); }, 2500); }
    showSurprised() { this.resetExpressions(); this.setExpression('surprised', 0.8); this.headTX = -0.04; setTimeout(() => { this.headTX = 0; this.setExpression('surprised', 0); }, 1800); }
    showThinking() { this.resetExpressions(); this.headTX = -0.03; this.headTY = 0.06; this.setExpression('relaxed', 0.3); }
    stopThinking() { this.headTX = 0; this.headTY = 0; this.setExpression('relaxed', 0); }
    nod() { let c = 0; const o = this.headTX; const iv = setInterval(() => { c++; this.headTX = c % 2 === 0 ? -0.06 : 0.02; if (c >= 4) { clearInterval(iv); this.headTX = o; } }, 200); }
    dispose() { if (this.vrm) { this.scene.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); } this.renderer.dispose(); }
}
