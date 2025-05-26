// app.js

import RFB from './js/rfb.js';
import KeyTable from './js/input/keysym.js';

// Global Three.js variables
let scene, camera, renderer;
let skySphere, vncScreenFlat, vncScreenCurved, vncTiledDisplayGroup;
let vncTexture;
let screenMaterial; // Shared material for flat/curved, tiles will have unique material instances

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
let effectiveScreenDistance = SCREEN_DISTANCE;
let currentCylinderThetaLength = Math.PI / 2.5; // Default, will be updated

let currentScreenType = 'flat';
let currentVncScreenObject = null;

// Tiled View settings
let tileRows = 2;
let tileCols = 2;
let tilePadding = 0.05; // World units
let tileMeshes = [];


// Camera control variables
const baseCameraFOV = 55;
const minFlattenFOV = 5;
let currentPanMode = 'xy-pan';

const imuEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const manualEuler = new THREE.Euler(0, 0, 0, 'YXZ'); // For 'rotate' pan mode
const cameraPanOffset = new THREE.Vector3(0, 0, 0); // For 'xy-pan' on flat screen
const targetCylindricalPan = { angle: 0, height: 0 }; // For 'xy-pan' on curved screens

let imuEnabled = false;
let isViewPannning = false;
let previousPanPosition = { x: 0, y: 0 };

const PAN_SENSITIVITY_XY_LINEAR = 0.001;
const PAN_SENSITIVITY_XY_ANGULAR = 0.001;
const PAN_SENSITIVITY_ROTATE = 0.0025;
const ZOOM_SENSITIVITY = 0.1;

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

const curvatureControlGroup = document.getElementById('curvatureControlGroup');
const curvatureSlider = document.getElementById('curvatureSlider');
const curvatureValueSpan = document.getElementById('curvatureValue');

// Tiled View UI Elements
const tiledViewControlsGroup = document.getElementById('tiledViewControlsGroup');
const tileRowsSlider = document.getElementById('tileRowsSlider');
const tileRowsValueSpan = document.getElementById('tileRowsValue');
const tileColsSlider = document.getElementById('tileColsSlider');
const tileColsValueSpan = document.getElementById('tileColsValue');
const tilePaddingSlider = document.getElementById('tilePaddingSlider');
const tilePaddingValueSpan = document.getElementById('tilePaddingValue');


const connectStatusDiv = document.getElementById('connectStatus');
const fullscreenButton = document.getElementById('fullscreenButton');
const permissionButton = document.getElementById('permissionButton');

const LS_KEY_HOST = 'vncViewerHost';
const LS_KEY_PORT = 'vncViewerPort';
const LS_KEY_RESOLUTION = 'vncViewerResolution';
const LS_KEY_SCREEN_TYPE = 'vncViewerScreenType';
const LS_KEY_CURVATURE = 'vncViewerCurvature';
const LS_KEY_SCREEN_DISTANCE = 'vncViewerScreenDistance';
const LS_KEY_PAN_OFFSET_X = 'vncViewerPanOffsetX';
const LS_KEY_PAN_OFFSET_Y = 'vncViewerPanOffsetY';
const LS_KEY_CYL_PAN_ANGLE = 'vncViewerCylPanAngle';
const LS_KEY_CYL_PAN_HEIGHT = 'vncViewerCylPanHeight';
const LS_KEY_MANUAL_EULER_X = 'vncViewerManualEulerX';
const LS_KEY_MANUAL_EULER_Y = 'vncViewerManualEulerY';
const LS_KEY_TILE_ROWS = 'vncViewerTileRows';
const LS_KEY_TILE_COLS = 'vncViewerTileCols';
const LS_KEY_TILE_PADDING = 'vncViewerTilePadding';


function initThreeJS() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(baseCameraFOV, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(0, 0, 0);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        precision: 'highp'
    });
    renderer.setPixelRatio(window.devicePixelRatio);
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
    vncTexture.magFilter = THREE.NearestFilter; // Nearest for sharp pixels, Linear for smoother
    vncTexture.generateMipmaps = false;
    if (renderer.capabilities.getMaxAnisotropy) {
        vncTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }

    screenMaterial = new THREE.MeshBasicMaterial({ map: vncTexture, side: THREE.DoubleSide });

    const flatGeometry = new THREE.PlaneGeometry(SCREEN_WIDTH_WORLD, SCREEN_HEIGHT_WORLD);
    vncScreenFlat = new THREE.Mesh(flatGeometry, screenMaterial);
    scene.add(vncScreenFlat);
    currentVncScreenObject = vncScreenFlat;

    vncScreenCurved = new THREE.Mesh(new THREE.BufferGeometry(), screenMaterial);
    vncScreenCurved.rotation.y = Math.PI;
    vncScreenCurved.scale.x = -1;
    scene.add(vncScreenCurved);
    vncScreenCurved.visible = false;

    vncTiledDisplayGroup = new THREE.Group();
    vncTiledDisplayGroup.name = "VNC_Tiled_Display_Group"; // For easier debugging in inspectors
    scene.add(vncTiledDisplayGroup);
    vncTiledDisplayGroup.visible = false; // Start hidden

    updateScreenObjectPositions();

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    loadSettings();

    // Initialize slider values from loaded settings
    tileRowsSlider.value = tileRows;
    tileRowsValueSpan.textContent = tileRows;
    tileColsSlider.value = tileCols;
    tileColsValueSpan.textContent = tileCols;
    tilePaddingSlider.value = tilePadding;
    tilePaddingValueSpan.textContent = tilePadding.toFixed(2);


    screenTypeSelect.dispatchEvent(new Event('change'));
    curvatureSlider.dispatchEvent(new Event('input'));
    // Trigger initial tile view update if that's the loaded type
    if (currentScreenType === 'tiled') {
        console.log("[InitThreeJS] Loaded screen type is 'tiled'. Calling updateTiledView().");
        updateTiledView();
    }


    window.addEventListener('resize', onWindowResize, false);
    addInteractionControls();
    addUISliderListeners();
    setupUIToggle();
}

function updateScreenGeometryAndInitialDistance(vncWidth, vncHeight) {
    if (!vncWidth || !vncHeight || vncWidth <= 0 || vncHeight <= 0) {
        console.warn(`[UpdateScreenGeo] Invalid VNC dimensions: ${vncWidth}x${vncHeight}. Using defaults.`);
        vncWidth = 800; vncHeight = 600;
    }

    const vFov = THREE.MathUtils.degToRad(baseCameraFOV);
    SCREEN_HEIGHT_WORLD = 2.0; // Fixed world height for baseline
    SCREEN_WIDTH_WORLD = (vncWidth / vncHeight) * SCREEN_HEIGHT_WORLD;

    const targetAngularHeightRatio = 0.7; // Try to make the screen occupy this ratio of FOV vertically
    const targetAngularHeight = vFov * targetAngularHeightRatio;
    let newScreenDistance = (SCREEN_HEIGHT_WORLD / 2) / Math.tan(targetAngularHeight / 2);

    // Only set SCREEN_DISTANCE from calculation if it wasn't loaded from localStorage
    if (localStorage.getItem(LS_KEY_SCREEN_DISTANCE) === null) {
         SCREEN_DISTANCE = Math.max(MIN_SCREEN_DISTANCE, Math.min(MAX_SCREEN_DISTANCE, newScreenDistance));
    }
    if (isNaN(SCREEN_DISTANCE) || SCREEN_DISTANCE <= 0) SCREEN_DISTANCE = 3; // Safety default

    if (vncScreenFlat.geometry) vncScreenFlat.geometry.dispose();
    vncScreenFlat.geometry = new THREE.PlaneGeometry(SCREEN_WIDTH_WORLD, SCREEN_HEIGHT_WORLD);

    console.log(`[UpdateScreenGeo] VNC ${vncWidth}x${vncHeight} | World ${SCREEN_WIDTH_WORLD.toFixed(2)}x${SCREEN_HEIGHT_WORLD.toFixed(2)} | BaseDist ${SCREEN_DISTANCE.toFixed(2)} | EffDist before proj: ${effectiveScreenDistance.toFixed(2)}`);

    updateCameraProjectionAndScreenDistance(); // This will call updateScreenObjectPositions which in turn calls updateTiledView if needed

    console.log(`[UpdateScreenGeo] Completed. EffDist after proj: ${effectiveScreenDistance.toFixed(2)}`);
}

function updateCameraProjectionAndScreenDistance() {
    if (!camera) return;
    console.log(`[UpdateCamProj] Start. Current Screen Type: ${currentScreenType}, Current FOV: ${camera.fov}, SCREEN_DISTANCE: ${SCREEN_DISTANCE}`);

    if (currentScreenType === 'flattened-curved') {
        const lerpFactor = parseFloat(curvatureSlider.value) / 100.0;
        camera.fov = THREE.MathUtils.lerp(minFlattenFOV, baseCameraFOV, lerpFactor);

        const baseFOVRads = THREE.MathUtils.degToRad(baseCameraFOV);
        const currentFOVRads = THREE.MathUtils.degToRad(camera.fov);

        if (Math.tan(currentFOVRads / 2) > 0.0001 && Math.tan(baseFOVRads / 2) > 0.0001) {
            effectiveScreenDistance = SCREEN_DISTANCE * (Math.tan(baseFOVRads / 2) / Math.tan(currentFOVRads / 2));
        } else {
            effectiveScreenDistance = SCREEN_DISTANCE;
        }
        effectiveScreenDistance = Math.max(MIN_SCREEN_DISTANCE, Math.min(MAX_SCREEN_DISTANCE * 10, effectiveScreenDistance)); // Allow larger effective for flattened
    } else {
        camera.fov = baseCameraFOV;
        effectiveScreenDistance = SCREEN_DISTANCE;
    }
    camera.updateProjectionMatrix();
    console.log(`[UpdateCamProj] End. New FOV: ${camera.fov}, New EffectiveDist: ${effectiveScreenDistance.toFixed(2)}`);
    updateScreenObjectPositions();
}

function updateScreenObjectPositions() {
    if (!camera ) return;
    console.log(`[UpdateScreenObjPos] Called. EffectiveDist: ${effectiveScreenDistance.toFixed(2)}, ScreenWorld: ${SCREEN_WIDTH_WORLD.toFixed(2)}x${SCREEN_HEIGHT_WORLD.toFixed(2)}`);

    if (vncScreenFlat) {
        vncScreenFlat.position.set(0, 0, -effectiveScreenDistance);
    }

    if (vncScreenCurved) {
        const curveRadius = effectiveScreenDistance * 0.95; // Slightly inside effective distance for better viewing
        let curveAngle = SCREEN_WIDTH_WORLD / curveRadius;

        if (curveAngle <= 0.001 || isNaN(curveAngle) || curveRadius <= 0.001) {
            console.warn("[UpdateScreenObjPos] Invalid curve angle or radius, using default for curved screen.", {curveAngle, curveRadius});
            curveAngle = Math.PI / 3; // Default angle
        } else {
            curveAngle = Math.min(curveAngle, Math.PI * 1.5); // Cap max angle
        }
        currentCylinderThetaLength = curveAngle;

        const radialSegments = Math.max(32, Math.floor(SCREEN_WIDTH_WORLD * 10)); // More segments for wider screens

        if(vncScreenCurved.geometry) vncScreenCurved.geometry.dispose();
        vncScreenCurved.geometry = new THREE.CylinderGeometry(
            Math.max(0.01, curveRadius), // Min radius
            Math.max(0.01, curveRadius),
            SCREEN_HEIGHT_WORLD,
            radialSegments,
            1, true, // openEnded = true
            -curveAngle / 2, curveAngle // Centered around Z-axis
        );
        // Position cylinder so its "front" surface is at -effectiveScreenDistance
        vncScreenCurved.position.set(0, 0, -effectiveScreenDistance + curveRadius - 0.001); // -0.001 to prevent z-fighting if radius is effectiveScreenDistance
    }

    if (currentScreenType === 'tiled') {
        console.log("[UpdateScreenObjPos] Current type is tiled. Calling updateTiledView().");
        updateTiledView();
    }
}

function updateTiledView() {
    console.log('[UpdateTiledView] Called.');
    if (!vncTiledDisplayGroup || !vncTexture) {
        console.warn('[UpdateTiledView] Critical: Missing vncTiledDisplayGroup or vncTexture object.');
        return;
    }
    if (!vncTexture.image) {
        console.warn('[UpdateTiledView] Warning: vncTexture.image is null/undefined. Tiles might use placeholder or old image.');
        // Tiles will use the placeholder canvas if this is the case initially
    }


    console.log(`[UpdateTiledView] Clearing ${tileMeshes.length} existing tiles. Group children before clear: ${vncTiledDisplayGroup.children.length}`);
    tileMeshes.forEach(tile => {
        if (tile.geometry) tile.geometry.dispose();
        if (tile.material) {
            if (tile.material.map && tile.material.map !== vncTexture) {
                // Check if it's a cloned texture by seeing if it's a distinct object from the main vncTexture
                if (tile.material.map.uuid !== vncTexture.uuid) {
                    console.log("[UpdateTiledView] Disposing cloned texture map for a tile (UUID different).");
                    tile.material.map.dispose();
                }
            }
            tile.material.dispose();
        }
        vncTiledDisplayGroup.remove(tile);
    });
    tileMeshes = [];
    console.log(`[UpdateTiledView] Group children after clear: ${vncTiledDisplayGroup.children.length}`);


    console.log(`[UpdateTiledView] Input Params: ScreenWorld: ${SCREEN_WIDTH_WORLD.toFixed(2)}x${SCREEN_HEIGHT_WORLD.toFixed(2)}, Tiles: ${tileRows}x${tileCols}, Padding: ${tilePadding.toFixed(2)}, EffDist: ${effectiveScreenDistance.toFixed(2)}`);

    if (SCREEN_WIDTH_WORLD <= 0.001 || SCREEN_HEIGHT_WORLD <= 0.001 || tileRows <= 0 || tileCols <= 0 || effectiveScreenDistance <= 0.001) {
        console.warn('[UpdateTiledView] Invalid dimensions or distance for creating tiles. Aborting tile creation loop.',
            { SCREEN_WIDTH_WORLD, SCREEN_HEIGHT_WORLD, tileRows, tileCols, effectiveScreenDistance });
        // Fallback: Add a single red square to see if the group itself is visible
        if (vncTiledDisplayGroup.children.length === 0) {
            console.log('[UpdateTiledView] Adding fallback RED test tile due to invalid params.');
            const testGeo = new THREE.PlaneGeometry(1, 1);
            const testMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, wireframe: false });
            const testMesh = new THREE.Mesh(testGeo, testMat);
            testMesh.position.set(0, 0, -Math.min(Math.abs(effectiveScreenDistance), 3) + 0.1); // Ensure it's in front and visible if EffDist is 0
            testMesh.name = "FALLBACK_RED_TILE";
            vncTiledDisplayGroup.add(testMesh);
            tileMeshes.push(testMesh);
        }
        return;
    }

    const tileBaseWidth = SCREEN_WIDTH_WORLD / tileCols;
    const tileBaseHeight = SCREEN_HEIGHT_WORLD / tileRows;
    console.log(`[UpdateTiledView] Tile base dimensions: ${tileBaseWidth.toFixed(2)}x${tileBaseHeight.toFixed(2)}`);


    if (tileBaseWidth <= 0.001 || tileBaseHeight <= 0.001) {
         console.warn('[UpdateTiledView] Tile base width or height is too small or zero. Aborting tile creation loop.');
         return;
    }

    // Total angular span hint (not strictly enforced, depends on padding)
    const totalAngularWidthHint = SCREEN_WIDTH_WORLD / effectiveScreenDistance;
    const totalAngularHeightHint = SCREEN_HEIGHT_WORLD / effectiveScreenDistance;

    // Calculate spacing based on the number of tiles and padding
    // For N tiles, there are N items and N-1 paddings between them for a total span.
    // If only 1 tile, no padding factor needed for its placement relative to center.
    const effectiveTotalWidthWithPadding = SCREEN_WIDTH_WORLD + (tileCols > 1 ? (tileCols - 1) * tilePadding : 0);
    const effectiveTotalHeightWithPadding = SCREEN_HEIGHT_WORLD + (tileRows > 1 ? (tileRows - 1) * tilePadding : 0);

    const angularStepX = (tileCols > 1) ? (tileBaseWidth + tilePadding) / effectiveScreenDistance : 0;
    const angularStepY = (tileRows > 1) ? (tileBaseHeight + tilePadding) / effectiveScreenDistance : 0;


    for (let r = 0; r < tileRows; r++) { // row index, 0 is top
        for (let c = 0; c < tileCols; c++) { // column index, 0 is left
            const tileGeometry = new THREE.PlaneGeometry(tileBaseWidth, tileBaseHeight);

            const clonedTexture = vncTexture.clone(); // Clone the main texture
            clonedTexture.needsUpdate = true; // Important for cloned textures to apply offset/repeat

            const texU = c / tileCols;
            const texV = 1.0 - (r + 1) / tileRows;
            const repU = 1.0 / tileCols;
            const repV = 1.0 / tileRows;

            clonedTexture.offset.set(texU, texV);
            clonedTexture.repeat.set(repU, repV);

            console.log(`[UpdateTiledView] Tile (${r},${c}): Texture Offset=(${texU.toFixed(2)},${texV.toFixed(2)}), Repeat=(${repU.toFixed(2)},${repV.toFixed(2)})`);

            const tileMaterial = new THREE.MeshBasicMaterial({
                map: clonedTexture,
                side: THREE.DoubleSide,
                // wireframe: true // Helpful for debugging if texture is the issue
            });

            const tileMesh = new THREE.Mesh(tileGeometry, tileMaterial);
            tileMesh.userData = { col: c, row: r, id: `tile_${r}_${c}` };
            tileMesh.name = `VNC_Tile_${r}_${c}`;

            // Azimuth: angle in XZ plane (horizontal), Elevation: angle from XZ plane (vertical)
            // Center the grid of tiles:
            // For 'c' from 0 to tileCols-1,  (c - (tileCols - 1) / 2.0) ranges from -(tileCols-1)/2 to +(tileCols-1)/2
            const azimuth = (c - (tileCols - 1) / 2.0) * angularStepX;
            // For elevation, r=0 is top row. ((tileRows - 1) / 2.0 - r) makes r=0 highest, r=tileRows-1 lowest.
            const elevation = ((tileRows - 1) / 2.0 - r) * angularStepY;

            // Spherical coordinates to Cartesian
            // Standard spherical: x = r * sin(elev) * cos(azim), y = r * sin(elev) * sin(azim), z = r * cos(elev)
            // Three.js convention (Y-up):
            // x = radius * cos(elevation) * sin(azimuth)
            // y = radius * sin(elevation)
            // z = radius * cos(elevation) * cos(azimuth) --- and negative for in front of camera
            tileMesh.position.x = effectiveScreenDistance * Math.cos(elevation) * Math.sin(azimuth);
            tileMesh.position.y = effectiveScreenDistance * Math.sin(elevation);
            tileMesh.position.z = -effectiveScreenDistance * Math.cos(elevation) * Math.cos(azimuth); // Negative Z

            if (isNaN(tileMesh.position.x) || isNaN(tileMesh.position.y) || isNaN(tileMesh.position.z)) {
                console.error(`[UpdateTiledView] Tile (${r},${c}) Position is NaN! Skipping add. Azimuth: ${azimuth}, Elev: ${elevation}, angularStepX: ${angularStepX}, angularStepY: ${angularStepY}`);
                tileGeometry.dispose();
                if (clonedTexture && clonedTexture.uuid !== vncTexture.uuid) clonedTexture.dispose();
                tileMaterial.dispose();
                continue; // Skip adding this tile
            }

            tileMesh.lookAt(0, 0, 0); // Orient tile to face the origin (camera's default look-at point)
            console.log(`[UpdateTiledView] Tile (${r},${c}) Added. Pos: (${tileMesh.position.x.toFixed(2)}, ${tileMesh.position.y.toFixed(2)}, ${tileMesh.position.z.toFixed(2)})`);


            vncTiledDisplayGroup.add(tileMesh);
            tileMeshes.push(tileMesh);
        }
    }
    console.log(`[UpdateTiledView] Loop finished. Created ${tileMeshes.length} VNC tiles. Group children: ${vncTiledDisplayGroup.children.length}`);
    if (tileMeshes.length === 0 && (tileRows > 0 && tileCols > 0)) {
        console.warn("[UpdateTiledView] Tile creation loop completed but tileMeshes array is empty. This indicates a problem inside the loop (e.g., NaN positions or zero base dimensions).");
    }
}


function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    if (rfb && rfb._fbWidth && rfb._fbHeight) {
         updateScreenGeometryAndInitialDistance(rfb._fbWidth, rfb._fbHeight);
    } else {
        // If VNC not connected, still need to update projection for current screen size
        updateCameraProjectionAndScreenDistance();
    }
}

function updateCameraOrientation() {
    if (!camera) return;

    const finalPosition = new THREE.Vector3();
    const finalQuaternion = new THREE.Quaternion();
    const baseViewQuaternion = new THREE.Quaternion();
    const _imuQuaternion = new THREE.Quaternion().setFromEuler(imuEuler);

    if (currentPanMode === 'xy-pan') {
        if (currentVncScreenObject === vncScreenFlat || !currentVncScreenObject) {
            finalPosition.set(cameraPanOffset.x, cameraPanOffset.y, 0);
            const lookAtTarget = new THREE.Vector3(cameraPanOffset.x, cameraPanOffset.y, -1);
            const tempMatrix = new THREE.Matrix4().lookAt(finalPosition, lookAtTarget, camera.up);
            baseViewQuaternion.setFromRotationMatrix(tempMatrix);
        } else { // Curved or FlattenedCurved (currentVncScreenObject === vncScreenCurved)
            const curveRadius = effectiveScreenDistance * 0.95;
            const panAngle = targetCylindricalPan.angle;
            const panHeight = targetCylindricalPan.height;

            const targetSurfacePoint = new THREE.Vector3();
            targetSurfacePoint.x = curveRadius * Math.sin(panAngle);
            targetSurfacePoint.y = panHeight;
            const cylinderAxisZ = -effectiveScreenDistance + curveRadius;
            targetSurfacePoint.z = cylinderAxisZ - curveRadius * Math.cos(panAngle);

            const normalTowardsCamera = new THREE.Vector3(-Math.sin(panAngle), 0, Math.cos(panAngle));
            finalPosition.copy(targetSurfacePoint).addScaledVector(normalTowardsCamera, effectiveScreenDistance);

            const tempMatrix = new THREE.Matrix4().lookAt(finalPosition, targetSurfacePoint, camera.up);
            baseViewQuaternion.setFromRotationMatrix(tempMatrix);
        }
    } else { // 'rotate' mode (includes 'tiled')
        finalPosition.set(0,0,0);
        baseViewQuaternion.setFromEuler(manualEuler);
    }

    if (imuEnabled && (imuEuler.x !== 0 || imuEuler.y !== 0 || imuEuler.z !== 0)) {
        finalQuaternion.multiplyQuaternions(_imuQuaternion, baseViewQuaternion);
    } else {
        finalQuaternion.copy(baseViewQuaternion);
    }

    camera.position.copy(finalPosition);
    camera.quaternion.slerp(finalQuaternion, 0.6); // Smooth slerp
    camera.updateMatrixWorld(true);
}

function updateVNCCursor() {
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
            vncTexture.image = rfb._canvas; // Update the main texture's image source
            vncTexture.needsUpdate = true; // Mark main texture for update
            // Cloned textures for tiles use the same image source (rfb._canvas).
            // Their 'map' property points to their own Texture object instance,
            // but the underlying image data comes from this shared canvas.
            // The `clonedTexture.needsUpdate = true;` at their creation time ensures
            // their specific UV mappings are applied with the new image data.
            // No need to iterate tileMeshes here to set needsUpdate on their maps
            // unless the texture *object* itself was being replaced per tile, which it isn't.
        }
        // Check if VNC canvas content has changed and needs re-upload to GPU
        if (rfb._canvas.width > 0 && rfb._canvas.height > 0 ) {
            const display = rfb.get_display ? rfb.get_display() : null;
            if (display && display.pending()) { // noVNC internal flag for pending updates
                 vncTexture.needsUpdate = true;
            } else if (!display) { // If get_display is not available, assume update is needed
                 vncTexture.needsUpdate = true;
            }
        }
    }
    updateVNCCursor();

    // Debugging checks (can be commented out for performance)
    // if (currentScreenType === 'tiled' && vncTiledDisplayGroup) {
    //    if (!vncTiledDisplayGroup.visible) console.warn("Tiled mode, but vncTiledDisplayGroup.visible is false in animate loop!");
    //    if (vncTiledDisplayGroup.children.length === 0 && (tileRows > 0 && tileCols > 0) && SCREEN_WIDTH_WORLD > 0.01) console.warn("Tiled mode, 0 children in vncTiledDisplayGroup in animate loop, but should have tiles!");
    // }

    renderer.render(scene, camera);
}

function connectVNC() {
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
    localStorage.setItem(LS_KEY_HOST, vncHostInput.value);
    localStorage.setItem(LS_KEY_PORT, vncPortInput.value);
    localStorage.setItem(LS_KEY_RESOLUTION, vncResolutionInput.value);

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
        rfb = new RFB(dummyTargetForRfb, websocketUrl, { credentials: { password: password }, shared: true });
        rfb.scaleViewport = false; rfb.clipViewport = false; rfb.resizeSession = !preferredResolution.auto;
    } catch (e) {
        connectStatusDiv.textContent = `Error initializing RFB: ${e.message}`;
        console.error("RFB instantiation error:", e);
        setControlsVisibility(true); return;
    }
    rfb.addEventListener('connect', () => {
        connectStatusDiv.textContent = `Connected! (Server: ${rfb._fbName || '...'})`;
        settingsPane.classList.add('hidden'); activeControlsPane.classList.remove('hidden');
        if (rfb._canvas) {
            vncTexture.image = rfb._canvas;
            vncTexture.needsUpdate = true;
            console.log("[VNC Connect] rfb._canvas assigned to vncTexture.image.");
        } else {
            console.error("[VNC Connect] rfb._canvas NOT found!");
        }
        // Delay geometry update slightly to ensure FB dimensions are settled
        setTimeout(() => {
            if (rfb && rfb._fbWidth && rfb._fbHeight) {
                let currentFbWidth = rfb._fbWidth; let currentFbHeight = rfb._fbHeight;
                console.log(`[VNC Connect] Initial FB size: ${currentFbWidth}x${currentFbHeight}`);
                if (!preferredResolution.auto && rfb.resizeSession && rfb._supportsSetDesktopSize &&
                    (preferredResolution.width !== currentFbWidth || preferredResolution.height !== currentFbHeight)) {
                    console.log(`[VNC Connect] Requesting resize to ${preferredResolution.width}x${preferredResolution.height}`);
                    RFB.messages.setDesktopSize(rfb._sock, preferredResolution.width, preferredResolution.height, rfb._screenID, rfb._screenFlags);
                    // updateScreenGeometryAndInitialDistance will be called by 'desktopsize' event
                } else {
                    updateScreenGeometryAndInitialDistance(currentFbWidth, currentFbHeight);
                }
            } else {
                console.warn("[VNC Connect] FB dimensions not available after connect, using fallback for geometry.");
                updateScreenGeometryAndInitialDistance(800, 600); // Fallback
            }
             // Explicitly update tiled view if it's the current type, as geometry might have changed
             if (currentScreenType === 'tiled') {
                console.log("[VNC Connect] Post-connect/resize, updating tiled view.");
                updateTiledView();
            }
        }, 300); // Increased delay
        renderer.domElement.focus();
    });
    rfb.addEventListener('desktopsize', (event) => {
        let w, h;
        if (event.detail && event.detail.width && event.detail.height) {
            w = event.detail.width; h = event.detail.height;
        } else if (rfb && rfb._fbWidth && rfb._fbHeight) {
            w = rfb._fbWidth; h = rfb._fbHeight;
        }
        console.log(`[DesktopSize Event] Received: ${w}x${h}`);
        if (w && h) {
            updateScreenGeometryAndInitialDistance(w, h);
            // updateScreenGeometryAndInitialDistance calls updateCameraProjectionAndScreenDistance,
            // which calls updateScreenObjectPositions, which calls updateTiledView if needed.
            // So, an explicit call to updateTiledView here might be redundant but safe.
            if (currentScreenType === 'tiled') {
                console.log("[DesktopSize Event] Updating tiled view due to desktop size change.");
                updateTiledView();
            }
        }
    });
    rfb.addEventListener('disconnect', (event) => {
        const clean = event.detail && event.detail.clean;
        connectStatusDiv.textContent = `Disconnected. ${clean ? "Cleanly." : "Unexpectedly."}`;
        setControlsVisibility(true); settingsPane.classList.remove('hidden'); activeControlsPane.classList.add('hidden');

        // Revert to placeholder texture
        const placeholderCanvas = document.createElement('canvas'); // Create new to avoid issues if old one was from rfb
        placeholderCanvas.width = 256; placeholderCanvas.height = 144;
        const ctx = placeholderCanvas.getContext('2d');
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, 256, 144);
        ctx.fillStyle = '#999999'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
        ctx.fillText('Disconnected', 128, 72);

        if (vncTexture) {
            vncTexture.image = placeholderCanvas;
            vncTexture.needsUpdate = true;
            console.log("[VNC Disconnect] Switched vncTexture.image to placeholder.");
        }

        if (currentScreenType === 'tiled') {
            console.log("[VNC Disconnect] Updating tiled view with placeholder texture.");
            updateTiledView(); // Update tiles to use the placeholder
        }
        rfb = null;
    });
    rfb.addEventListener('credentialsrequired', () => {
        const pass = prompt("Password required (leave blank if none):");
        rfb.sendCredentials({ password: pass || "" });
    });
    rfb.addEventListener('desktopname', (event) => {
        if (rfb && rfb._rfbConnectionState === 'connected') { // Check state as this can fire late
             connectStatusDiv.textContent = `Connected! (Server: ${event.detail.name})`;
        }
    });
}
function disconnectVNC() { if (rfb) rfb.disconnect(); } // disconnect will trigger event causing UI/texture updates

function requestMotionPermission() {
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
    } else if (typeof DeviceOrientationEvent !== 'undefined') { // For browsers that don't require explicit permission
        window.addEventListener('deviceorientation', handleOrientation, true);
        imuEnabled = true; permissionButton.textContent = "Motion Tracking Active (auto)"; permissionButton.disabled = true;
    } else {
        imuEnabled = false; alert('Device orientation not supported.');
        permissionButton.textContent = "Motion API Not Supported"; permissionButton.disabled = true;
    }
}
const degToRad = THREE.MathUtils.degToRad;
function handleOrientation(event) {
    if (!event.alpha && !event.beta && !event.gamma) return; // No data
    if (!imuEnabled) return;
    imuEuler.set(degToRad(event.beta), degToRad(event.alpha), -degToRad(event.gamma), 'YXZ'); // Standard order
}

function addInteractionControls() {
    renderer.domElement.addEventListener('mousedown', (event) => {
        if (event.shiftKey && event.altKey && event.metaKey) { // View panning
            isViewPannning = true;
            previousPanPosition.x = event.clientX; previousPanPosition.y = event.clientY;
            uiContainer.classList.add('dragging'); event.preventDefault();
        } else { // VNC interaction or freelook
            let freelookPan = false;
            if (!rfb && event.buttons === 1 && !event.shiftKey && !event.altKey && !event.metaKey) { // Left button, no VNC, no modifiers = freelook
                isViewPannning = true; freelookPan = true;
                previousPanPosition.x = event.clientX; previousPanPosition.y = event.clientY;
            }
            // Only proceed with VNC mouse event if not freelook panning and VNC is connected and there's a screen object
            if (!freelookPan && rfb && currentVncScreenObject) {
                if (document.activeElement !== renderer.domElement) renderer.domElement.focus(); // Focus for keyboard
                handleVNCMouseEvent(event, 'down');
            }
        }
    });

    window.addEventListener('mousemove', (event) => { // Listen on window for dragging outside canvas
        if (isViewPannning) {
            const deltaX = event.clientX - previousPanPosition.x;
            const deltaY = event.clientY - previousPanPosition.y;
            previousPanPosition.x = event.clientX; previousPanPosition.y = event.clientY;

            let activePanMode = currentPanMode;
            // Force 'rotate' mode for freelook (no VNC, no modifiers, left button down during drag)
            if (!rfb && !event.shiftKey && !event.altKey && !event.metaKey && (event.buttons === 1 || (event.type === 'mousemove' && isViewPannning))) {
                 if(document.pointerLockElement === renderer.domElement || event.buttons === 1) {
                    activePanMode = 'rotate';
                 }
            }

            if (activePanMode === 'xy-pan') {
                if (currentVncScreenObject === vncScreenFlat || !currentVncScreenObject) { // Default to flat-like pan if no object
                    const panFactor = effectiveScreenDistance * PAN_SENSITIVITY_XY_LINEAR;
                    cameraPanOffset.x -= deltaX * panFactor;
                    cameraPanOffset.y += deltaY * panFactor;
                } else { // Curved or FlattenedCurved
                    const curveRadius = effectiveScreenDistance * 0.95;
                    if (curveRadius > 0.01) {
                        targetCylindricalPan.angle -= (deltaX * PAN_SENSITIVITY_XY_ANGULAR * effectiveScreenDistance) / curveRadius;
                        targetCylindricalPan.height += deltaY * PAN_SENSITIVITY_XY_LINEAR * effectiveScreenDistance;

                        const maxAngle = currentCylinderThetaLength / 2; // Use the calculated theta length
                        targetCylindricalPan.angle = Math.max(-maxAngle, Math.min(maxAngle, targetCylindricalPan.angle));
                        const maxHeight = SCREEN_HEIGHT_WORLD / 2;
                        targetCylindricalPan.height = Math.max(-maxHeight, Math.min(maxHeight, targetCylindricalPan.height));
                    }
                }
            } else { // 'rotate' mode
                manualEuler.y -= deltaX * PAN_SENSITIVITY_ROTATE;
                manualEuler.x -= deltaY * PAN_SENSITIVITY_ROTATE;
                manualEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, manualEuler.x)); // Clamp pitch
            }
            saveSettings(); // Save relevant pan/rotation state
        } else { // Not view panning, potentially VNC mouse move
            if (rfb && currentVncScreenObject) {
                handleVNCMouseEvent(event, 'move');
            }
        }
    });

    window.addEventListener('mouseup', (event) => { // Listen on window
        if (isViewPannning) {
            isViewPannning = false; uiContainer.classList.remove('dragging');
            if(document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        }
        // Send VNC mouse up if not view panning modifier keys were active
        if (rfb && currentVncScreenObject && !(event.shiftKey && event.altKey && event.metaKey)) {
            handleVNCMouseEvent(event, 'up');
        }
    });

    document.addEventListener('mouseleave', () => { // If mouse leaves the document entirely while panning
        if (isViewPannning) { isViewPannning = false; uiContainer.classList.remove('dragging'); }
    });

    renderer.domElement.addEventListener('wheel', (event) => {
        if (event.shiftKey && event.altKey && event.metaKey) { // Zoom with modifiers
            event.preventDefault(); // Prevent page scroll
            const zoomFactor = 1.0 - (event.deltaY * ZOOM_SENSITIVITY * 0.01);
            SCREEN_DISTANCE /= zoomFactor;
            SCREEN_DISTANCE = Math.max(MIN_SCREEN_DISTANCE, Math.min(MAX_SCREEN_DISTANCE, SCREEN_DISTANCE));
            updateCameraProjectionAndScreenDistance(); // This will update effective distance and re-layout tiles if needed
            saveSettings();
        }
        // Note: VNC scroll events are typically sent as button 4/5 events,
        // noVNC handles this if the browser generates wheel events that RFB.js can interpret.
        // If specific scroll forwarding is needed, it would be in handleVNCMouseEvent
        // or a separate wheel handler that sends appropriate VNC commands.
    }, { passive: false }); // `passive: false` to allow `preventDefault`

    renderer.domElement.addEventListener('contextmenu', (event) => {
        if (isViewPannning) { event.preventDefault(); return; } // Prevent context menu during view pan
        // Prevent context menu if over the VNC screen, as right-click is a VNC event
        if (rfb && currentVncScreenObject) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObject(currentVncScreenObject, true);
            if (intersects.length > 0) event.preventDefault();
        }
    });
    renderer.domElement.addEventListener('keydown', (event) => {
        if (isViewPannning || !rfb) return;
        const code = event.code; let keysym = KeyTable[code];
        // Prevent default for keys that RFB should handle or that cause page actions
        if (KeyTable.hasOwnProperty(code) || (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) ||
            ["Tab", "Enter", "Escape", "Backspace", "Delete"].includes(event.key) ||
            (event.key.startsWith("Arrow") && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey)
        ) { event.preventDefault(); }

        if (keysym === undefined) { // Try to map if not in KeyTable directly by code
            if (event.key.length === 1) keysym = event.key.charCodeAt(0); // Single character
            else { // Map common special keys by event.key
                switch (event.key) {
                    case 'Escape': keysym = KeyTable.XK_Escape; break; case 'Tab': keysym = KeyTable.XK_Tab; break;
                    case 'Backspace': keysym = KeyTable.XK_BackSpace; break; case 'Enter': keysym = KeyTable.XK_Return; break;
                    case 'Delete': keysym = KeyTable.XK_Delete; break;
                    // Modifiers are usually handled by KeyTable[code], but as fallback:
                    case 'Shift': keysym = (code === "ShiftLeft") ? KeyTable.XK_Shift_L : KeyTable.XK_Shift_R; break;
                    case 'Control': keysym = (code === "ControlLeft") ? KeyTable.XK_Control_L : KeyTable.XK_Control_R; break;
                    case 'Alt': keysym = (code === "AltLeft") ? KeyTable.XK_Alt_L : KeyTable.XK_Alt_R; break;
                    case 'Meta': keysym = (code === "MetaLeft" || code === "OSLeft") ? KeyTable.XK_Meta_L : KeyTable.XK_Meta_R; break;
                    default: console.warn(`Unmapped keydown: key="${event.key}", code="${code}"`); return;
                }
            }
        }
        if (keysym !== undefined) rfb.sendKey(keysym, code, true); // Send key down
    });
    renderer.domElement.addEventListener('keyup', (event) => {
        if (isViewPannning || !rfb) return;
        const code = event.code; let keysym = KeyTable[code];
        // No preventDefault on keyup generally needed unless specific issues arise
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
                    default: return; // Don't warn on unmapped keyups
                }
            }
        }
        if (keysym !== undefined) rfb.sendKey(keysym, code, false); // Send key up
    });
    // Freelook pointer lock initiation
    renderer.domElement.addEventListener('mousedown', (event) => {
        if (!rfb && event.buttons === 1 && !event.shiftKey && !event.altKey && !event.metaKey) { // Left button, no VNC, no modifiers
            if(renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
        }
    });
}
function handleVNCMouseEvent(event, type) { // type is 'down', 'up', or 'move'
    if (!rfb || !currentVncScreenObject || !rfb._canvas || rfb._canvas.width === 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(currentVncScreenObject, true); // true for recursive if currentVncScreenObject is a Group

    if (intersects.length > 0) {
        const intersect = intersects[0];
        const localUV = intersect.uv;
        if (!localUV) {
            console.warn("[VNC Mouse] Intersection found but no UV coordinates.");
            return;
        }
        const fbWidth = rfb._fbWidth; const fbHeight = rfb._fbHeight;
        if (!fbWidth || !fbHeight) { console.warn("[VNC Mouse] rfb._fbWidth or rfb._fbHeight not available."); return; }

        let vncX, vncY;

        if (currentScreenType === 'tiled') {
            const tileObject = intersect.object; // This is the specific tile mesh
            const tileData = tileObject.userData; // {col, row, id}
            if (!tileData || typeof tileData.col === 'undefined' || typeof tileData.row === 'undefined') {
                console.warn("[VNC Mouse] Intersected tile has no or invalid userData:", tileObject);
                return;
            }

            vncX = Math.floor(((tileData.col + localUV.x) / tileCols) * fbWidth);
            vncY = Math.floor(((tileData.row + (1.0 - localUV.y)) / tileRows) * fbHeight); // UV.y is bottom-up
        } else {
            // Original logic for flat/curved screens (UVs are global for these)
            vncX = Math.floor(localUV.x * fbWidth);
            vncY = Math.floor((1.0 - localUV.y) * fbHeight); // Standard UV y is bottom-up
        }

        // Clamp coordinates to be within framebuffer bounds
        vncX = Math.max(0, Math.min(vncX, fbWidth - 1));
        vncY = Math.max(0, Math.min(vncY, fbHeight - 1));

        let buttonMask = RFB._convertButtonMask(event.buttons);
        // RFB.js handles scroll wheel as buttons 4 (up) and 5 (down)
        // This requires detecting wheel events and translating them if not done by RFB.js directly
        // For now, relying on RFB.js's default pointer event handling for buttons.

        if (rfb.sendPointerEvent) rfb.sendPointerEvent(vncX, vncY, buttonMask);
        else if (rfb._sendMouse) rfb._sendMouse(vncX, vncY, buttonMask); // Fallback for older noVNC
        else console.warn("[VNC Mouse] No method found on RFB to send pointer events.");
    }
}

function setControlsVisibility(showFullPane) {
    if (showFullPane) {
        controlsContainer.classList.remove('hidden');
        controlsToggle.classList.remove('collapsed');
        controlsToggle.innerHTML = '✕'; controlsToggle.title = "Hide Settings";
    } else {
        controlsContainer.classList.add('hidden');
        controlsToggle.classList.add('collapsed');
        controlsToggle.innerHTML = '☰'; controlsToggle.title = "Show Settings";
    }
}
function setupUIToggle() {
    setControlsVisibility(true); // Start with controls visible by default
    settingsPane.classList.remove('hidden'); // Show connection settings initially
    activeControlsPane.classList.add('hidden'); // Hide active session controls
    controlsToggle.addEventListener('click', () => {
        const isHidden = controlsContainer.classList.contains('hidden');
        setControlsVisibility(isHidden);
    });
}
function loadSettings() {
    vncHostInput.value = localStorage.getItem(LS_KEY_HOST) || 'localhost';
    vncPortInput.value = localStorage.getItem(LS_KEY_PORT) || '5901';
    vncResolutionInput.value = localStorage.getItem(LS_KEY_RESOLUTION) || 'auto';

    screenTypeSelect.value = localStorage.getItem(LS_KEY_SCREEN_TYPE) || 'flat';
    currentScreenType = screenTypeSelect.value; // Ensure global var matches loaded value before init calls

    curvatureSlider.value = localStorage.getItem(LS_KEY_CURVATURE) || '100';
    curvatureValueSpan.textContent = curvatureSlider.value;

    SCREEN_DISTANCE = parseFloat(localStorage.getItem(LS_KEY_SCREEN_DISTANCE)) || 3.0;
    if (isNaN(SCREEN_DISTANCE) || SCREEN_DISTANCE <=0) SCREEN_DISTANCE = 3.0;


    cameraPanOffset.x = parseFloat(localStorage.getItem(LS_KEY_PAN_OFFSET_X)) || 0;
    cameraPanOffset.y = parseFloat(localStorage.getItem(LS_KEY_PAN_OFFSET_Y)) || 0;

    targetCylindricalPan.angle = parseFloat(localStorage.getItem(LS_KEY_CYL_PAN_ANGLE)) || 0;
    targetCylindricalPan.height = parseFloat(localStorage.getItem(LS_KEY_CYL_PAN_HEIGHT)) || 0;

    manualEuler.x = parseFloat(localStorage.getItem(LS_KEY_MANUAL_EULER_X)) || 0;
    manualEuler.y = parseFloat(localStorage.getItem(LS_KEY_MANUAL_EULER_Y)) || 0;

    tileRows = parseInt(localStorage.getItem(LS_KEY_TILE_ROWS) || '2', 10);
    tileCols = parseInt(localStorage.getItem(LS_KEY_TILE_COLS) || '2', 10);
    tilePadding = parseFloat(localStorage.getItem(LS_KEY_TILE_PADDING) || '0.05');
    if (isNaN(tileRows) || tileRows <=0) tileRows = 2;
    if (isNaN(tileCols) || tileCols <=0) tileCols = 2;
    if (isNaN(tilePadding) || tilePadding < 0) tilePadding = 0.05;

    console.log("[LoadSettings] Loaded settings:", { screenType: currentScreenType, distance: SCREEN_DISTANCE, tileRows, tileCols, tilePadding });
}
function saveSettings() {
    localStorage.setItem(LS_KEY_SCREEN_TYPE, screenTypeSelect.value);
    localStorage.setItem(LS_KEY_CURVATURE, curvatureSlider.value);
    localStorage.setItem(LS_KEY_SCREEN_DISTANCE, SCREEN_DISTANCE.toString());

    localStorage.setItem(LS_KEY_PAN_OFFSET_X, cameraPanOffset.x.toString());
    localStorage.setItem(LS_KEY_PAN_OFFSET_Y, cameraPanOffset.y.toString());

    localStorage.setItem(LS_KEY_CYL_PAN_ANGLE, targetCylindricalPan.angle.toString());
    localStorage.setItem(LS_KEY_CYL_PAN_HEIGHT, targetCylindricalPan.height.toString());

    localStorage.setItem(LS_KEY_MANUAL_EULER_X, manualEuler.x.toString());
    localStorage.setItem(LS_KEY_MANUAL_EULER_Y, manualEuler.y.toString());

    localStorage.setItem(LS_KEY_TILE_ROWS, tileRows.toString());
    localStorage.setItem(LS_KEY_TILE_COLS, tileCols.toString());
    localStorage.setItem(LS_KEY_TILE_PADDING, tilePadding.toString());
}

connectButton.addEventListener('click', connectVNC);
disconnectButton.addEventListener('click', disconnectVNC);

screenTypeSelect.addEventListener('change', (event) => {
    currentScreenType = event.target.value;

    // Set all to invisible first to ensure clean switch
    if (vncScreenFlat) vncScreenFlat.visible = false;
    if (vncScreenCurved) vncScreenCurved.visible = false;
    if (vncTiledDisplayGroup) vncTiledDisplayGroup.visible = false;

    // Hide all specific controls first
    curvatureControlGroup.classList.add('hidden');
    tiledViewControlsGroup.classList.add('hidden');

    const oldPanMode = currentPanMode;

    if (currentScreenType === 'flat') {
        if (vncScreenFlat) vncScreenFlat.visible = true;
        currentVncScreenObject = vncScreenFlat;
        currentPanMode = 'xy-pan';
    } else if (currentScreenType === 'curved') {
        if (vncScreenCurved) vncScreenCurved.visible = true;
        currentVncScreenObject = vncScreenCurved;
        currentPanMode = 'rotate';
    } else if (currentScreenType === 'flattened-curved') {
        if (vncScreenCurved) vncScreenCurved.visible = true;
        currentVncScreenObject = vncScreenCurved;
        curvatureControlGroup.classList.remove('hidden');
        currentPanMode = 'xy-pan';
    } else if (currentScreenType === 'tiled') {
        if (vncTiledDisplayGroup) vncTiledDisplayGroup.visible = true;
        currentVncScreenObject = vncTiledDisplayGroup;
        tiledViewControlsGroup.classList.remove('hidden');
        currentPanMode = 'rotate';
        console.log("[ScreenTypeChange] Switched to Tiled. Calling updateTiledView().");
        updateTiledView(); // Initial creation or update of tiles
    } else {
        currentVncScreenObject = null; // Fallback, should not happen
        console.warn("[ScreenTypeChange] Unknown screen type selected:", currentScreenType);
    }

    console.log(`[ScreenTypeChange] Current type: ${currentScreenType}, Pan mode: ${currentPanMode}, FlatVisible: ${vncScreenFlat ? vncScreenFlat.visible : 'N/A'}, CurvedVisible: ${vncScreenCurved ? vncScreenCurved.visible : 'N/A'}, TiledGroupVisible: ${vncTiledDisplayGroup ? vncTiledDisplayGroup.visible : 'N/A'}`);


    // Pan mode switching logic - can be refined to reset states if desired
    if (currentPanMode !== oldPanMode) {
        // Example: If switching TO xy-pan from rotate, reset manualEuler for a straight-on view.
        // if (currentPanMode === 'xy-pan' && oldPanMode === 'rotate') {
        //     manualEuler.set(0,0,0);
        // }
        // Example: If switching TO rotate from xy-pan, reset pan offsets.
        // if (currentPanMode === 'rotate' && oldPanMode === 'xy-pan') {
        //     cameraPanOffset.set(0,0,0);
        //     targetCylindricalPan.angle = 0; targetCylindricalPan.height = 0;
        // }
    }

    updateCameraProjectionAndScreenDistance(); // This will also call updateScreenObjectPositions -> updateTiledView if needed
    saveSettings();
});

curvatureSlider.addEventListener('input', (event) => {
    curvatureValueSpan.textContent = event.target.value;
    updateCameraProjectionAndScreenDistance(); // This will update effective distance for flattened-curved
    saveSettings();
});

function addUISliderListeners() {
    tileRowsSlider.addEventListener('input', (event) => {
        tileRows = parseInt(event.target.value, 10);
        if (isNaN(tileRows) || tileRows <=0) tileRows = 1; // Min 1 row
        tileRowsValueSpan.textContent = tileRows;
        if (currentScreenType === 'tiled') {
            console.log("[TileRowsSlider] Value changed. Calling updateTiledView().");
            updateTiledView();
        }
        saveSettings();
    });
    tileColsSlider.addEventListener('input', (event) => {
        tileCols = parseInt(event.target.value, 10);
        if (isNaN(tileCols) || tileCols <=0) tileCols = 1; // Min 1 col
        tileColsValueSpan.textContent = tileCols;
        if (currentScreenType === 'tiled') {
            console.log("[TileColsSlider] Value changed. Calling updateTiledView().");
            updateTiledView();
        }
        saveSettings();
    });
    tilePaddingSlider.addEventListener('input', (event) => {
        tilePadding = parseFloat(event.target.value);
        if (isNaN(tilePadding) || tilePadding < 0) tilePadding = 0; // Min 0 padding
        tilePaddingValueSpan.textContent = tilePadding.toFixed(2);
        if (currentScreenType === 'tiled') {
            console.log("[TilePaddingSlider] Value changed. Calling updateTiledView().");
            updateTiledView();
        }
        saveSettings();
    });
}


fullscreenButton.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else uiContainer.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
});
permissionButton.addEventListener('click', requestMotionPermission);

// --- Initialization ---
initThreeJS();
animate();
