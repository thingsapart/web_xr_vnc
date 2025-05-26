import RFB from './js/rfb.js';
import KeyTable from './js/input/keysym.js';

// Global Three.js variables
let scene, camera, renderer;
let skySphere, vncScreenFlat, vncScreenCurved;
let vncTexture;
let screenMaterial;

// VNC state
let rfb;
let dummyTargetForRfb;
let preferredResolution = { width: 0, height: 0, auto: true };

// Screen properties
let SCREEN_DISTANCE = 3;
let SCREEN_WIDTH_WORLD = 3.2;
let SCREEN_HEIGHT_WORLD = 1.8;
const MIN_SCREEN_DISTANCE = 0.1;
const MAX_SCREEN_DISTANCE = 50;

let currentScreenType = 'flat';
let currentVncScreenObject = null;

// Camera control variables
const imuEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const manualEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let imuEnabled = false;
let isViewPannning = false;
let previousPanPosition = { x: 0, y: 0 };
const PAN_SENSITIVITY = 0.0025;
const ZOOM_SENSITIVITY = 0.1; // This will now be used as a factor

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const uiContainer = document.getElementById('container');
const controlsContainer = document.getElementById('controlsContainer');
const settingsPane = document.getElementById('settingsPane');
const activeControlsPane = document.getElementById('activeControlsPane');
const controlsToggle = document.getElementById('controlsToggle');

const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const vncHostInput = document.getElementById('vncHost');
const vncPortInput = document.getElementById('vncPort');
const vncPasswordInput = document.getElementById('vncPassword');
const vncResolutionInput = document.getElementById('vncResolution');
const screenTypeSelect = document.getElementById('screenType');

const connectStatusDiv = document.getElementById('connectStatus');
const fullscreenButton = document.getElementById('fullscreenButton');
const permissionButton = document.getElementById('permissionButton');

const LS_KEY_HOST = 'vncViewerHost';
const LS_KEY_PORT = 'vncViewerPort';
const LS_KEY_RESOLUTION = 'vncViewerResolution';

function initThreeJS() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(0, 0, 0);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        precision: 'highp'
    });
    renderer.setPixelRatio(window.devicePixelRatio); // Key for HiDPI displays
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.outline = 'none';
    renderer.domElement.setAttribute('tabindex', '0');
    uiContainer.appendChild(renderer.domElement);

    const skyGeometry = new THREE.SphereGeometry(400, 60, 40);
    skyGeometry.scale(-1, 1, 1);
    const skyMaterial = new THREE.MeshBasicMaterial({ color: 0x1a2028 });
    skySphere = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(skySphere);

    const placeholderCanvas = document.createElement('canvas');
    placeholderCanvas.width = 256; placeholderCanvas.height = 144;
    const ctx = placeholderCanvas.getContext('2d');
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, 256, 144);
    ctx.fillStyle = '#999999'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
    ctx.fillText('VNC Not Connected', 128, 72);

    vncTexture = new THREE.CanvasTexture(placeholderCanvas);
    vncTexture.minFilter = THREE.LinearFilter;
    vncTexture.magFilter = THREE.NearestFilter; // For crisp magnified text
    vncTexture.generateMipmaps = false;
    if (renderer.capabilities.getMaxAnisotropy) {
        vncTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    // vncTexture.colorSpace = THREE.SRGBColorSpace; // If using sRGB output encoding in renderer

    screenMaterial = new THREE.MeshBasicMaterial({ map: vncTexture, side: THREE.DoubleSide });

    const flatGeometry = new THREE.PlaneGeometry(SCREEN_WIDTH_WORLD, SCREEN_HEIGHT_WORLD);
    vncScreenFlat = new THREE.Mesh(flatGeometry, screenMaterial);
    vncScreenFlat.position.set(0,0,-SCREEN_DISTANCE);
    scene.add(vncScreenFlat);
    currentVncScreenObject = vncScreenFlat;

    const curvedGeometry = new THREE.CylinderGeometry(SCREEN_DISTANCE * 0.95, SCREEN_DISTANCE * 0.95, SCREEN_HEIGHT_WORLD, 64, 1, true, -Math.PI / 5.0, Math.PI / 2.5);
    vncScreenCurved = new THREE.Mesh(curvedGeometry, screenMaterial);
    vncScreenCurved.rotation.y = Math.PI;
    vncScreenCurved.scale.x = -1; // <<<< FIX FOR CURVED SCREEN MIRRORING
    vncScreenCurved.position.set(0,0,-SCREEN_DISTANCE + (SCREEN_DISTANCE*0.95) - 0.001);
    scene.add(vncScreenCurved);
    vncScreenCurved.visible = false;

    updateScreenObjectPositions(); // Initial positioning based on default SCREEN_DISTANCE

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    loadSettings();
    window.addEventListener('resize', onWindowResize, false);
    addInteractionControls();
    setupUIToggle();
}

// This function is primarily for when VNC resolution changes or initial setup
function updateScreenGeometryAndInitialDistance(vncWidth, vncHeight) {
    if (!vncWidth || !vncHeight || vncWidth <= 0 || vncHeight <= 0) {
        console.warn("updateScreenGeometry: Invalid VNC dimensions.", vncWidth, vncHeight);
        vncWidth = 800; vncHeight = 600; // Fallback
    }
    if (!camera || camera.fov <= 0) {
        console.warn("updateScreenGeometry: Camera or FOV invalid.");
        return;
    }

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    if (vFov <= 0 || isNaN(vFov)) {
        console.warn("updateScreenGeometry: Calculated vFov is invalid.");
        return;
    }

    SCREEN_HEIGHT_WORLD = 2.0;
    SCREEN_WIDTH_WORLD = (vncWidth / vncHeight) * SCREEN_HEIGHT_WORLD;

    const targetAngularHeightRatio = 0.7;
    const targetAngularHeight = vFov * targetAngularHeightRatio;

    let newScreenDistance;
    if (Math.tan(targetAngularHeight / 2) > 0) {
        newScreenDistance = (SCREEN_HEIGHT_WORLD / 2) / Math.tan(targetAngularHeight / 2);
    } else {
        newScreenDistance = 5;
    }
    SCREEN_DISTANCE = Math.max(MIN_SCREEN_DISTANCE, Math.min(MAX_SCREEN_DISTANCE, newScreenDistance));
    if (isNaN(SCREEN_DISTANCE)) SCREEN_DISTANCE = 5;

    // Update Flat Screen Geometry
    if (vncScreenFlat.geometry) vncScreenFlat.geometry.dispose();
    vncScreenFlat.geometry = new THREE.PlaneGeometry(SCREEN_WIDTH_WORLD, SCREEN_HEIGHT_WORLD);

    // Update Curved Screen Geometry
    const curveRadius = SCREEN_DISTANCE * 0.95;
    const curveAngle = SCREEN_WIDTH_WORLD / curveRadius; // Ensure curveAngle is reasonable
    if(vncScreenCurved.geometry) vncScreenCurved.geometry.dispose();
    vncScreenCurved.geometry = new THREE.CylinderGeometry(
        curveRadius, curveRadius, SCREEN_HEIGHT_WORLD,
        Math.max(32, Math.floor(SCREEN_WIDTH_WORLD * 20)),
        1, true, -curveAngle / 2, curveAngle
    );

    updateScreenObjectPositions(); // Apply new distance and positions
    console.log(`Screen Geo & Dist Updated: VNC ${vncWidth}x${vncHeight} | World ${SCREEN_WIDTH_WORLD.toFixed(2)}x${SCREEN_HEIGHT_WORLD.toFixed(2)} | Dist ${SCREEN_DISTANCE.toFixed(2)}`);
}

// This function ONLY updates positions based on current SCREEN_DISTANCE and world sizes
function updateScreenObjectPositions() {
    if (!vncScreenFlat || !vncScreenCurved) return;

    vncScreenFlat.position.set(0, 0, -SCREEN_DISTANCE);

    const curveRadius = SCREEN_DISTANCE * 0.95;
    // We might need to re-create curved geometry if its radius depends on SCREEN_DISTANCE for visual consistency
    // For simplicity with zoom, we'll just move it. Recreating geometry on every zoom scroll is too much.
    // This means the *curvature* relative to its size stays, but its distance changes.
    // For a more "zoom into the curve" effect, its geometry parameters would need to scale with SCREEN_DISTANCE.
    // Let's try to update the cylinder radius based on current SCREEN_DISTANCE when zooming.
    const currentCurveAngle = SCREEN_WIDTH_WORLD / curveRadius; // Re-calculate angle if radius changed

    if(vncScreenCurved.geometry) vncScreenCurved.geometry.dispose();
    vncScreenCurved.geometry = new THREE.CylinderGeometry(
        curveRadius, curveRadius, SCREEN_HEIGHT_WORLD,
        Math.max(32, Math.floor(SCREEN_WIDTH_WORLD * 20)),
        1, true, -currentCurveAngle / 2, currentCurveAngle
    );
    vncScreenCurved.position.set(0, 0, -SCREEN_DISTANCE + curveRadius -0.001);
}


function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(window.devicePixelRatio); // Ensure pixel ratio is updated on resize too
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (rfb && rfb._fbWidth && rfb._fbHeight) {
         updateScreenGeometryAndInitialDistance(rfb._fbWidth, rfb._fbHeight); // Recalc for aspect
    }
}

function updateCameraOrientation() { /* ... identical ... */
    if (!camera) return;
    const finalQuaternion = new THREE.Quaternion();
    const _manualQuaternion = new THREE.Quaternion().setFromEuler(manualEuler);

    if (imuEnabled && (imuEuler.x !== 0 || imuEuler.y !== 0 || imuEuler.z !== 0)) {
        const _imuQuaternion = new THREE.Quaternion().setFromEuler(imuEuler);
        finalQuaternion.multiplyQuaternions(_imuQuaternion, _manualQuaternion);
    } else {
        finalQuaternion.copy(_manualQuaternion);
    }
    camera.quaternion.slerp(finalQuaternion, 0.6);
}
function updateVNCCursor() { /* ... identical ... */
    if (rfb && rfb._canvas && renderer.domElement) {
        if (renderer.domElement.style.cursor !== rfb._canvas.style.cursor) {
            renderer.domElement.style.cursor = rfb._canvas.style.cursor;
        }
    } else if (renderer.domElement) {
        renderer.domElement.style.cursor = 'default';
    }
}

function animate() {
    requestAnimationFrame(animate);
    if(!scene || !camera || !renderer) return;

    updateCameraOrientation();

    if (rfb && rfb._canvas) {
        if (vncTexture.image !== rfb._canvas) {
            vncTexture.image = rfb._canvas;
        }
        if (rfb._canvas.width > 0 && rfb._canvas.height > 0 ) {
            const display = rfb.get_display ? rfb.get_display() : null; // get_display might not exist on new rfb
            if (display && display.pending()) { // Check if RFB's display has pending updates
                 vncTexture.needsUpdate = true;
            } else if (!display) { // If no pending(), update always for safety (less optimal)
                 vncTexture.needsUpdate = true;
            }
        }
    }

    updateVNCCursor();
    renderer.render(scene, camera);
}

function connectVNC() { /* ... largely identical, ensure rfb.scaleViewport = false and rfb.clipViewport = false are set ... */
    const host = vncHostInput.value;
    const port = vncPortInput.value;
    const password = vncPasswordInput.value;
    const resValue = vncResolutionInput.value.toLowerCase().trim();

    if (resValue === 'auto') {
        preferredResolution.auto = true;
    } else {
        const parts = resValue.split('x');
        if (parts.length === 2) {
            const w = parseInt(parts[0], 10); const h = parseInt(parts[1], 10);
            if (w > 0 && h > 0) {
                preferredResolution.width = w; preferredResolution.height = h; preferredResolution.auto = false;
            } else {
                alert("Invalid resolution. Use 'auto' or 'WIDTHxHEIGHT'. Defaulting to auto.");
                preferredResolution.auto = true; vncResolutionInput.value = "auto";
            }
        } else {
            alert("Invalid resolution. Use 'auto' or 'WIDTHxHEIGHT'. Defaulting to auto.");
            preferredResolution.auto = true; vncResolutionInput.value = "auto";
        }
    }
    saveSettings();

    if (rfb) disconnectVNC();

    connectStatusDiv.textContent = `Connecting to ws://${host}:${port}...`;
    setControlsVisibility(false);

    if (!dummyTargetForRfb) {
        dummyTargetForRfb = document.createElement('div');
        dummyTargetForRfb.id = "noVNC_hidden_target"; dummyTargetForRfb.style.display = 'none';
        document.body.appendChild(dummyTargetForRfb);
    }

    const websocketUrl = `ws://${host}:${port}`;

    try {
        rfb = new RFB(dummyTargetForRfb, websocketUrl, {
            credentials: { password: password }, shared: true,
        });
        rfb.scaleViewport = false; // CRITICAL for our texture source
        rfb.clipViewport = false;  // We manage viewport
        rfb.resizeSession = !preferredResolution.auto;

    } catch (e) {
        connectStatusDiv.textContent = `Error initializing RFB: ${e.message}`;
        console.error("RFB instantiation error:", e);
        setControlsVisibility(true);
        return;
    }

    rfb.addEventListener('connect', () => {
        connectStatusDiv.textContent = `Connected! (Server: ${rfb._fbName || '...'})`;
        settingsPane.classList.add('hidden');
        activeControlsPane.classList.remove('hidden');

        if (rfb._canvas) {
            vncTexture.image = rfb._canvas; vncTexture.needsUpdate = true;
            console.log("RFB Canvas assigned. Actual CSS size:", rfb._canvas.style.width, rfb._canvas.style.height, "Backing store size:", rfb._canvas.width, "x", rfb._canvas.height);

        } else {
            console.error("VNC Connect: rfb._canvas NOT found!");
        }

        setTimeout(() => { // Wait for rfb._fbWidth/Height to be populated by server init
            if (rfb && rfb._fbWidth && rfb._fbHeight) {
                let currentFbWidth = rfb._fbWidth; let currentFbHeight = rfb._fbHeight;
                if (!preferredResolution.auto && rfb.resizeSession && rfb._supportsSetDesktopSize &&
                    (preferredResolution.width !== currentFbWidth || preferredResolution.height !== currentFbHeight)) {
                    RFB.messages.setDesktopSize(rfb._sock, preferredResolution.width, preferredResolution.height, rfb._screenID, rfb._screenFlags);
                } else { // Auto res, or server doesn't support resize, or res matches
                    updateScreenGeometryAndInitialDistance(currentFbWidth, currentFbHeight);
                }
            } else { // Fallback if VNC server info not ready
                 updateScreenGeometryAndInitialDistance(800, 600);
            }
        }, 300);

        renderer.domElement.focus();
    });

    rfb.addEventListener('desktopsize', (event) => {
        let w, h;
        if (event.detail && event.detail.width && event.detail.height) {
            w = event.detail.width; h = event.detail.height;
        } else if (rfb && rfb._fbWidth && rfb._fbHeight) {
            w = rfb._fbWidth; h = rfb._fbHeight;
        }
        if (w && h) updateScreenGeometryAndInitialDistance(w, h); // Use this when res truly changes
    });

    rfb.addEventListener('disconnect', (event) => { /* ... identical ... */
        const clean = event.detail && event.detail.clean;
        connectStatusDiv.textContent = `Disconnected. ${clean ? "Cleanly." : "Unexpectedly."}`;
        setControlsVisibility(true);
        settingsPane.classList.remove('hidden');
        activeControlsPane.classList.add('hidden');

        const placeholderCanvas = document.createElement('canvas');
        placeholderCanvas.width = 256; placeholderCanvas.height = 144;
        const ctx = placeholderCanvas.getContext('2d');
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, 256, 144);
        ctx.fillStyle = '#999999'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
        ctx.fillText('Disconnected', 128, 72);

        if (vncTexture) { vncTexture.image = placeholderCanvas; vncTexture.needsUpdate = true; }
        rfb = null;
    });
    rfb.addEventListener('credentialsrequired', () => { /* ... identical ... */
        const pass = prompt("Password required (leave blank if none):");
        rfb.sendCredentials({ password: pass || "" });
    });
    rfb.addEventListener('desktopname', (event) => { /* ... identical ... */
        if (rfb && rfb._rfbConnectionState === 'connected') {
             connectStatusDiv.textContent = `Connected! (Server: ${event.detail.name})`;
        }
    });
}
function disconnectVNC() { if (rfb) rfb.disconnect(); }
function requestMotionPermission() { /* ... identical ... */
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation, true);
                    imuEnabled = true; permissionButton.textContent = "Motion Tracking Active"; permissionButton.disabled = true;
                } else {
                    imuEnabled = false; alert('Permission for motion tracking was denied.'); permissionButton.textContent = "Permission Denied";
                }
            }).catch(error => {
                imuEnabled = false; console.error('DeviceOrientationEvent.requestPermission error:', error);
                alert('Error requesting motion permission.'); permissionButton.textContent = "Motion Permission Error";
            });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
        window.addEventListener('deviceorientation', handleOrientation, true);
        imuEnabled = true; permissionButton.textContent = "Motion Tracking Active (auto)"; permissionButton.disabled = true;
    } else {
        imuEnabled = false; alert('Device orientation not supported.');
        permissionButton.textContent = "Motion API Not Supported"; permissionButton.disabled = true;
    }
}
const degToRad = THREE.MathUtils.degToRad;
function handleOrientation(event) { /* ... identical ... */
    if (!event.alpha && !event.beta && !event.gamma) return;
    if (!imuEnabled) return;
    imuEuler.set(degToRad(event.beta), degToRad(event.alpha), -degToRad(event.gamma), 'YXZ');
}

function addInteractionControls() {
    renderer.domElement.addEventListener('mousedown', (event) => {
        if (event.shiftKey && event.altKey && event.metaKey) {
            isViewPannning = true;
            previousPanPosition.x = event.clientX; previousPanPosition.y = event.clientY;
            uiContainer.classList.add('dragging'); event.preventDefault();
        } else {
            if (!rfb || !currentVncScreenObject) return;
            if (document.activeElement !== renderer.domElement) renderer.domElement.focus();
            handleVNCMouseEvent(event, 'down');
        }
    });

    window.addEventListener('mousemove', (event) => {
        if (isViewPannning) {
            const deltaX = event.clientX - previousPanPosition.x; const deltaY = event.clientY - previousPanPosition.y;
            manualEuler.y -= deltaX * PAN_SENSITIVITY; manualEuler.x -= deltaY * PAN_SENSITIVITY;
            manualEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, manualEuler.x));
            previousPanPosition.x = event.clientX; previousPanPosition.y = event.clientY;
        } else {
            if (!rfb || !currentVncScreenObject) return;
            handleVNCMouseEvent(event, 'move');
        }
    });

    window.addEventListener('mouseup', (event) => {
        if (isViewPannning) {
            isViewPannning = false; uiContainer.classList.remove('dragging');
        } else {
            if (!rfb || !currentVncScreenObject) return;
            handleVNCMouseEvent(event, 'up');
        }
    });

    document.addEventListener('mouseleave', () => {
        if (isViewPannning) { isViewPannning = false; uiContainer.classList.remove('dragging');}
    });

    renderer.domElement.addEventListener('wheel', (event) => {
        if (event.shiftKey && event.altKey && event.metaKey) {
            event.preventDefault();
            const zoomFactor = 1.0 - (event.deltaY * ZOOM_SENSITIVITY * 0.01); // Multiplicative factor
            SCREEN_DISTANCE /= zoomFactor; // Zoom by changing distance
            SCREEN_DISTANCE = Math.max(MIN_SCREEN_DISTANCE, Math.min(MAX_SCREEN_DISTANCE, SCREEN_DISTANCE));
            updateScreenObjectPositions(); // Update positions based on new SCREEN_DISTANCE
        }
    }, { passive: false });

    renderer.domElement.addEventListener('contextmenu', (event) => { /* ... identical ... */
        if (isViewPannning) return;
        if (rfb && currentVncScreenObject) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObject(currentVncScreenObject, true);
            if (intersects.length > 0) event.preventDefault();
        }
    });
    renderer.domElement.addEventListener('keydown', (event) => { /* ... identical, ensure Meta key mapping for Command/Win ... */
        if (isViewPannning || !rfb) return;
        const code = event.code; let keysym = KeyTable[code];
        if (KeyTable.hasOwnProperty(code) || (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) ||
            ["Tab", "Enter", "Escape", "Backspace", "Delete"].includes(event.key) ||
            (event.key.startsWith("Arrow") && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey)
        ) { event.preventDefault(); }

        if (keysym === undefined) {
            if (event.key.length === 1) keysym = event.key.charCodeAt(0);
            else {
                switch (event.key) {
                    case 'Escape': keysym = KeyTable.XK_Escape; break; case 'Tab': keysym = KeyTable.XK_Tab; break;
                    case 'Backspace': keysym = KeyTable.XK_BackSpace; break; case 'Enter': keysym = KeyTable.XK_Return; break;
                    case 'Delete': keysym = KeyTable.XK_Delete; break;
                    case 'Shift': keysym = (code === "ShiftLeft") ? KeyTable.XK_Shift_L : KeyTable.XK_Shift_R; break;
                    case 'Control': keysym = (code === "ControlLeft") ? KeyTable.XK_Control_L : KeyTable.XK_Control_R; break;
                    case 'Alt': keysym = (code === "AltLeft") ? KeyTable.XK_Alt_L : KeyTable.XK_Alt_R; break;
                    case 'Meta': keysym = (code === "MetaLeft" || code === "OSLeft") ? KeyTable.XK_Meta_L : KeyTable.XK_Meta_R; break; // Handle OSLeft for Windows key
                    default: console.warn(`Unmapped keydown: key="${event.key}", code="${code}"`); return;
                }
            }
        }
        if (keysym !== undefined) rfb.sendKey(keysym, code, true);
    });
    renderer.domElement.addEventListener('keyup', (event) => { /* ... identical, ensure Meta key mapping ... */
        if (isViewPannning || !rfb) return;
        const code = event.code; let keysym = KeyTable[code];
        if (keysym === undefined) {
            if (event.key.length === 1) keysym = event.key.charCodeAt(0);
            else {
                 switch (event.key) {
                    case 'Escape': keysym = KeyTable.XK_Escape; break; case 'Tab': keysym = KeyTable.XK_Tab; break;
                    case 'Backspace': keysym = KeyTable.XK_BackSpace; break; case 'Enter': keysym = KeyTable.XK_Return; break;
                    case 'Delete': keysym = KeyTable.XK_Delete; break;
                    case 'Shift': keysym = (code === "ShiftLeft") ? KeyTable.XK_Shift_L : KeyTable.XK_Shift_R; break;
                    case 'Control': keysym = (code === "ControlLeft") ? KeyTable.XK_Control_L : KeyTable.XK_Control_R; break;
                    case 'Alt': keysym = (code === "AltLeft") ? KeyTable.XK_Alt_L : KeyTable.XK_Alt_R; break;
                    case 'Meta': keysym = (code === "MetaLeft" || code === "OSLeft") ? KeyTable.XK_Meta_L : KeyTable.XK_Meta_R; break;
                    default: return;
                }
            }
        }
        if (keysym !== undefined) rfb.sendKey(keysym, code, false);
    });
}
function handleVNCMouseEvent(event, type) { /* ... identical ... */
    if (!rfb || !currentVncScreenObject || !rfb._canvas || rfb._canvas.width === 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(currentVncScreenObject, true);
    if (intersects.length > 0) {
        const uv = intersects[0].uv; if (!uv) return;
        // Use rfb._fbWidth/Height which is the true remote framebuffer size reported by server.
        // rfb._canvas.width/height is the backing store size, which includes devicePixelRatio.
        // For sending coordinates, we need them relative to the *unscaled* framebuffer.
        const fbWidth = rfb._fbWidth;
        const fbHeight = rfb._fbHeight;

        if (!fbWidth || !fbHeight) { // Safety check if these aren't populated yet
            console.warn("rfb._fbWidth or rfb._fbHeight not available for VNC mouse event.");
            return;
        }

        const vncX = Math.floor(uv.x * fbWidth); const vncY = Math.floor((1.0 - uv.y) * fbHeight);
        let buttonMask = 0;
        if (type === 'down' || type === 'move') buttonMask = RFB._convertButtonMask(event.buttons);
        else if (type === 'up') buttonMask = RFB._convertButtonMask(event.buttons);
        if (rfb._sendMouse) rfb._sendMouse(vncX, vncY, buttonMask);
        else if (rfb.sendPointerEvent) rfb.sendPointerEvent(vncX, vncY, buttonMask);
        else console.warn("No method found on RFB to send pointer events.");
    }
}

function setControlsVisibility(showFullPane) { /* ... identical ... */
    if (showFullPane) {
        controlsContainer.classList.remove('hidden');
        controlsToggle.classList.remove('collapsed');
        controlsToggle.innerHTML = '✕';
        controlsToggle.title = "Hide Settings";

    } else {
        controlsContainer.classList.add('hidden');
        controlsToggle.classList.add('collapsed');
        controlsToggle.innerHTML = '☰';
        controlsToggle.title = "Show Settings";
    }
}
function setupUIToggle() { /* ... identical ... */
    setControlsVisibility(true);
    settingsPane.classList.remove('hidden');
    activeControlsPane.classList.add('hidden');
    controlsToggle.addEventListener('click', () => {
        const isHidden = controlsContainer.classList.contains('hidden');
        setControlsVisibility(isHidden);
    });
}
function loadSettings() { /* ... identical ... */
    vncHostInput.value = localStorage.getItem(LS_KEY_HOST) || 'localhost';
    vncPortInput.value = localStorage.getItem(LS_KEY_PORT) || '5901';
    vncResolutionInput.value = localStorage.getItem(LS_KEY_RESOLUTION) || 'auto';
}
function saveSettings() { /* ... identical ... */
    localStorage.setItem(LS_KEY_HOST, vncHostInput.value);
    localStorage.setItem(LS_KEY_PORT, vncPortInput.value);
    localStorage.setItem(LS_KEY_RESOLUTION, vncResolutionInput.value);
}

connectButton.addEventListener('click', connectVNC);
disconnectButton.addEventListener('click', disconnectVNC);
screenTypeSelect.addEventListener('change', (event) => { /* ... identical ... */
    currentScreenType = event.target.value;
    if (currentScreenType === 'flat') {
        vncScreenFlat.visible = true; vncScreenCurved.visible = false;
        currentVncScreenObject = vncScreenFlat;
    } else {
        vncScreenFlat.visible = false; vncScreenCurved.visible = true;
        currentVncScreenObject = vncScreenCurved;
    }
});
fullscreenButton.addEventListener('click', () => { /* ... identical ... */
    if (document.fullscreenElement) document.exitFullscreen();
    else uiContainer.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
});
permissionButton.addEventListener('click', requestMotionPermission);

// --- Initialization ---
initThreeJS();
animate();
