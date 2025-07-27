class AutoBoard {
    constructor() {
        this.elements = [];
        this.currentGesture = 'None';
        this.isListening = false;
        this.selectedElement = null;
        this.dragOffset = { x: 0, y: 0 };
        this.deleteTimer = null;
        this.deleteElement = null;
        this.drawingPath = [];
        this.isDrawing = false;
        this.handPosition = { x: 0, y: 0 };
        this.cursorElement = null;
        this.arrowStartPoint = null;
        this.freeDrawPath = [];
        this.isFreeDrawing = false;
        this.selectedArrowPoint = null;

        // canvas contexts
        this.handsCanvas = document.getElementById('hands-canvas');
        this.handsCtx = this.handsCanvas.getContext('2d');
        this.flowchartCanvas = document.getElementById('flowchart-canvas');
        this.flowchartCtx = this.flowchartCanvas.getContext('2d');

        // mediapipe thingies
        this.hands = null;
        this.camera = null;

        // speech recognition
        this.recognition = null;

        this.init();
    }

    async init() {
        await this.setupCamera();
        this.setupMediaPipe();
        this.setupSpeechRecognition();
        this.setupEventListeners();
        this.resizeCanvases();
        this.startDetection();

        window.addEventListener('resize', () => this.resizeCanvases());
    }

    async setupCamera() {
        const video = document.getElementById('webcam');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 1280,
                    height: 720,
                    facingMode: 'user'
                },
                audio: false
            });

            video.srcObject = stream;

            // flip the camera horizontally cause its so annoying to use without flipping
            video.style.transform = 'scaleX(-1)';

            return new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    resolve(video);
                };
            });
        } catch (err) {
            console.error('Error accessing camera:', err);
            alert('Please allow camera access to use AutoBoard');
        }
    }

    setupMediaPipe() {
        this.hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults((results) => this.onHandsResults(results));
    }

    setupSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateVoiceStatus(true);
            };

            this.recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                this.addTextToSelectedElement(transcript);
            };

            this.recognition.onend = () => {
                this.isListening = false;
                this.updateVoiceStatus(false);
                this.selectedElement = null;
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.isListening = false;
                this.updateVoiceStatus(false);
            };
        } else {
            console.warn('Speech recognition not supported');
        }
    }

    setupEventListeners() {
        document.getElementById('exportBtn').addEventListener('click', () => this.exportDiagram());
        document.getElementById('clearBtn').addEventListener('click', () => this.clearAll());
    }

    startDetection() {
        const video = document.getElementById('webcam');

        this.camera = new Camera(video, {
            onFrame: async () => {
                await this.hands.send({ image: video });
            },
            width: 1280,
            height: 720
        });

        this.camera.start();
    }

    resizeCanvases() {
        const container = document.querySelector('.viewport');
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.handsCanvas.width = width;
        this.handsCanvas.height = height;

        this.flowchartCanvas.width = width;
        this.flowchartCanvas.height = height;

        this.drawFlowchart();
    }

    onHandsResults(results) {
        // clear hands canvas
        this.handsCtx.save();
        this.handsCtx.clearRect(0, 0, this.handsCanvas.width, this.handsCanvas.height);

        // flip the canvas context to match flipped video!!
        this.handsCtx.scale(-1, 1);
        this.handsCtx.translate(-this.handsCanvas.width, 0);

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];

            this.handPosition = this.getHandCenter(landmarks);
            this.cursorElement = this.getElementAtPosition(this.handPosition.x, this.handPosition.y);

            this.drawHandLandmarks(landmarks);

            const gesture = this.detectGesture(landmarks);
            this.handleGesture(gesture, landmarks);
        } else {
            this.currentGesture = 'None';
            this.updateGestureStatus();
            this.stopDelete();
            this.handPosition = { x: 0, y: 0 };
            this.cursorElement = null;
        }

        this.handsCtx.restore();

        // draw cursor after restoring context
        this.drawCursor();
    }

    drawHandLandmarks(landmarks) {
        // draw the hand connections
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],  // thumb
            [0, 5], [5, 6], [6, 7], [7, 8],  // index
            [0, 9], [9, 10], [10, 11], [11, 12],  // middle
            [0, 13], [13, 14], [14, 15], [15, 16],  // ring
            [0, 17], [17, 18], [18, 19], [19, 20],  // pinky
            [5, 9], [9, 13], [13, 17]  // palm
        ];

        this.handsCtx.strokeStyle = '#00ff88';
        this.handsCtx.lineWidth = 2;

        connections.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];

            this.handsCtx.beginPath();
            this.handsCtx.moveTo(startPoint.x * this.handsCanvas.width, startPoint.y * this.handsCanvas.height);
            this.handsCtx.lineTo(endPoint.x * this.handsCanvas.width, endPoint.y * this.handsCanvas.height);
            this.handsCtx.stroke();
        });

        // draw landmarks
        this.handsCtx.fillStyle = '#ff4757';
        landmarks.forEach(landmark => {
            this.handsCtx.beginPath();
            this.handsCtx.arc(
                landmark.x * this.handsCanvas.width,
                landmark.y * this.handsCanvas.height,
                3, 0, 2 * Math.PI
            );
            this.handsCtx.fill();
        });
    }

    detectGesture(landmarks) {
        // convert normalized coordinates to pixel coordinates (flipped)
        const points = landmarks.map(landmark => ({
            x: (1 - landmark.x) * this.handsCanvas.width,
            y: landmark.y * this.handsCanvas.height
        }));

        // finger tip and PIP joint indices
        const fingerTips = [4, 8, 12, 16, 20];  // thumb, index, middle, ring, pinky
        const fingerPIPs = [3, 6, 10, 14, 18];

        // Check which fingers are extended
        const extended = fingerTips.map((tip, i) => {
            if (i === 0) { // thumb (flipped)
                return points[tip].x < points[fingerPIPs[i]].x; // thumb extends horizontally (flipped)
            } else {
                return points[tip].y < points[fingerPIPs[i]].y; // other fingers extend vertically
            }
        });

        const extendedCount = extended.filter(Boolean).length;

        // gesture detection logic
        if (extendedCount === 0) {
            return 'closed_fist';
        } else if (extendedCount === 5) {
            return 'open_palm';
        } else if (extendedCount === 1 && extended[1]) {
            return 'one_finger';
        } else if (extendedCount === 2 && extended[1] && extended[2]) {
            return 'two_fingers';
        } else if (extendedCount === 3 && extended[1] && extended[2] && extended[3]) {
            return 'three_fingers';
        } else if (this.isPinchGesture(points)) {
            return 'pinch';
        }

        return 'unknown';
    }

    isPinchGesture(points) {
        const thumbTip = points[4];
        const indexTip = points[8];
        // distance between thumb and index finger tips
        const distance = Math.sqrt(Math.pow(thumbTip.x - indexTip.x, 2) + Math.pow(thumbTip.y - indexTip.y, 2));
        return distance < 40; // pinch threshold
    }

    handleGesture(gesture, landmarks) {
        const handCenter = this.getHandCenter(landmarks);

        switch (gesture) {
            case 'open_palm':
                this.handleOpenPalm(handCenter);
                break;
            case 'one_finger':
                this.handleOneFinger(handCenter);
                break;
            case 'pinch':
                this.handlePinch(handCenter);
                break;
            case 'two_fingers':
                this.handleTwoFingers(handCenter);
                break;
            case 'three_fingers':
                this.handleThreeFingers(handCenter);
                break;
            case 'closed_fist':
                this.handleClosedFist(handCenter);
                break;
            default:
                if (this.currentGesture !== 'None') {
                    this.finishCurrentAction();
                }
                this.currentGesture = 'None';
                break;
        }

        this.updateGestureStatus();
    }

    getHandCenter(landmarks) {
        // use flipped coordinates
        const x = (1 - landmarks[9].x) * this.handsCanvas.width; // middle finger MCP (flipped)
        const y = landmarks[9].y * this.handsCanvas.height;
        return { x, y };
    }

    handleOpenPalm(center) {
        if (this.currentGesture !== 'creating_box') {
            this.currentGesture = 'creating_box';
            // delay before creating box
            setTimeout(() => {
                if (this.currentGesture === 'creating_box') {
                    this.createBox(center);
                    this.finishCurrentAction();
                }
            }, 1000); // 1000ms delay
        }
    }

    handleOneFinger(center) {
        if (this.currentGesture !== 'creating_arrow') {
            this.currentGesture = 'creating_arrow';
            // make arrow with fixed length
            this.createFixedArrow(center);
            // finish immediately after creating arrow with shorter timeout?
            setTimeout(() => {
                if (this.currentGesture === 'creating_arrow') {
                    this.finishCurrentAction();
                }
            }, 300);
        }
    }

    handleThreeFingers(center) {
        if (this.currentGesture !== 'free_drawing') {
            this.currentGesture = 'free_drawing';
            this.freeDrawPath = [center];
            this.isFreeDrawing = true;
        } else {
            this.freeDrawPath.push(center);
            // we want to redraw immediately to show real-time drawing
            this.drawFlowchart();
        }
    }

    handlePinch(center) {
        if (this.currentGesture !== 'moving') {
            this.currentGesture = 'moving';
            const arrowPoint = this.getArrowPointAtPosition(center.x, center.y);
            if (arrowPoint) {
                this.selectedElement = arrowPoint.element;
                this.selectedArrowPoint = arrowPoint.point; // 'start' or 'end'
                this.dragOffset = {
                    x: center.x - (arrowPoint.point === 'start' ? arrowPoint.element.x1 : arrowPoint.element.x2),
                    y: center.y - (arrowPoint.point === 'start' ? arrowPoint.element.y1 : arrowPoint.element.y2)
                };
            } else {
                // select regular element at cursor position
                const element = this.cursorElement;
                if (element) {
                    this.selectedElement = element;
                    this.selectedArrowPoint = null;
                    this.dragOffset = {
                        x: center.x - element.x,
                        y: center.y - element.y
                    };
                }
            }
        } else if (this.selectedElement) {
            if (this.selectedElement.type === 'line' && this.selectedArrowPoint) {
                // move specific arrow endpoint
                if (this.selectedArrowPoint === 'start') {
                    this.selectedElement.x1 = center.x - this.dragOffset.x;
                    this.selectedElement.y1 = center.y - this.dragOffset.y;
                } else {
                    this.selectedElement.x2 = center.x - this.dragOffset.x;
                    this.selectedElement.y2 = center.y - this.dragOffset.y;
                }
            } else {
                // move regular element
                this.selectedElement.x = center.x - this.dragOffset.x;
                this.selectedElement.y = center.y - this.dragOffset.y;
            }
            this.drawFlowchart();
        }
    }

    handleTwoFingers(center) {
        if (this.currentGesture !== 'text_input') {
            const element = this.getElementAtPosition(center.x, center.y);
            if (element && element.type === 'box') {
                this.currentGesture = 'text_input';
                this.selectedElement = element;
                this.startVoiceInput();
            }
        }
    }

    handleClosedFist(center) {
        const element = this.getElementAtPosition(center.x, center.y);

        if (element && this.deleteElement === element) {
            if (!this.deleteTimer) {
                this.deleteTimer = setTimeout(() => {
                    this.deleteElementFromDiagram(element);
                    this.currentGesture = 'None';
                    this.stopDelete();
                }, 2000);
                this.currentGesture = 'deleting';
            }
        } else {
            // start new delete or stop current one
            this.stopDelete();
            if (element) {
                this.deleteElement = element;
                this.deleteTimer = setTimeout(() => {
                    this.deleteElementFromDiagram(element);
                    this.currentGesture = 'None';
                    this.stopDelete();
                }, 2000); // might want to make this shorter, not sure though
                this.currentGesture = 'deleting';
            }
        }
    }

    // algebra is actually useful apparently
    pointToLineDistance(point, lineStart, lineEnd) {
        const A = point.x - lineStart.x;
        const B = point.y - lineStart.y;
        const C = lineEnd.x - lineStart.x;
        const D = lineEnd.y - lineStart.y;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) {
            param = dot / lenSq;
        }

        let xx, yy;

        if (param < 0) {
            xx = lineStart.x;
            yy = lineStart.y;
        } else if (param > 1) {
            xx = lineEnd.x;
            yy = lineEnd.y;
        } else {
            xx = lineStart.x + param * C;
            yy = lineStart.y + param * D;
        }

        const dx = point.x - xx;
        const dy = point.y - yy;

        return Math.sqrt(dx * dx + dy * dy);
    }

    createBox(center) {
        const box = {
            type: 'box',
            id: Date.now(),
            x: center.x - 60,
            y: center.y - 40,
            width: 120,
            height: 80,
            text: ''
        };

        this.elements.push(box);
        this.drawFlowchart();
    }

    createFixedArrow(center) {
        // make arrow with fixed length (100px) pointing right
        const arrow = {
            type: 'line',
            id: Date.now(),
            x1: center.x - 50,
            y1: center.y,
            x2: center.x + 50,
            y2: center.y
        };

        this.elements.push(arrow);
        this.drawFlowchart();
    }

    createFreeDrawing(path) {
        const drawing = {
            type: 'drawing',
            id: Date.now(),
            path: [...path]
        };

        this.elements.push(drawing);
        this.drawFlowchart();
    }

    getArrowPointAtPosition(x, y) {
        const threshold = 35; // we can modify this distance threshold for easier arrow endpoint selection

        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            if (element.type === 'line') {
                // start point
                const startDist = Math.sqrt(Math.pow(x - element.x1, 2) + Math.pow(y - element.y1, 2));
                if (startDist < threshold) {
                    return { element, point: 'start' };
                }

                // end point
                const endDist = Math.sqrt(Math.pow(x - element.x2, 2) + Math.pow(y - element.y2, 2));
                if (endDist < threshold) {
                    return { element, point: 'end' };
                }
            }
        }

        return null;
    }


    createLine(path) {
        const start = path[0];
        const end = path[path.length - 1];

        const line = {
            type: 'line',
            id: Date.now(),
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y
        };

        this.elements.push(line);
        this.drawFlowchart();
    }

    getPathBounds(path) {
        const xs = path.map(p => p.x);
        const ys = path.map(p => p.y);

        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    }

    getElementAtPosition(x, y) {
        // check boxes first (they're more specific)
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            if (element.type === 'box') {
                if (x >= element.x && x <= element.x + element.width &&
                    y >= element.y && y <= element.y + element.height) {
                    return element;
                }
            }
        }

        // then lets check lines
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            if (element.type === 'line') {
                const distance = this.pointToLineDistance(
                    { x, y },
                    { x: element.x1, y: element.y1 },
                    { x: element.x2, y: element.y2 }
                );
                if (distance < 10) {
                    return element;
                }
            }
        }

        // finally check free drawings
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            if (element.type === 'drawing') {
                // check if point is near any part of the drawing path
                for (let j = 0; j < element.path.length; j++) {
                    const pathPoint = element.path[j];
                    const distance = Math.sqrt(Math.pow(x - pathPoint.x, 2) + Math.pow(y - pathPoint.y, 2));
                    if (distance < 15) {
                        return element;
                    }
                }
            }
        }

        return null;
    }

    startVoiceInput() {
        if (this.recognition && !this.isListening) {
            this.recognition.start();
        }
    }

    addTextToSelectedElement(text) {
        if (this.selectedElement && this.selectedElement.type === 'box') {
            this.selectedElement.text = text;
            this.drawFlowchart();
        }
    }

    deleteElementFromDiagram(element) {
        const index = this.elements.indexOf(element);
        if (index > -1) {
            this.elements.splice(index, 1);
            this.drawFlowchart();
        }
    }

    stopDelete() {
        if (this.deleteTimer) {
            clearTimeout(this.deleteTimer);
            this.deleteTimer = null;
        }
        this.deleteElement = null;
    }

    finishCurrentAction() {
        // complete free drawing when three fingers are lifted
        if (this.currentGesture === 'free_drawing' && this.freeDrawPath.length > 1) {
            this.createFreeDrawing(this.freeDrawPath);
            this.freeDrawPath = [];
            this.isFreeDrawing = false;
        }

        this.currentGesture = 'None';
        this.drawingPath = [];
        this.isDrawing = false;
        this.selectedElement = null;
        this.selectedArrowPoint = null;
        this.arrowStartPoint = null;
        this.stopDelete();
    }

    updateGestureStatus() {
        const gestureNames = {
            'None': 'Wave hand to start',
            'creating_box': 'Creating Box - hold palm steady...',
            'creating_arrow': 'Creating Arrow - fixed size',
            'moving': 'Moving Element - pinch and drag',
            'text_input': 'Voice Input - speak now',
            'free_drawing': 'Free Drawing - move to draw',
            'deleting': 'Deleting - hold fist for 2s',
            'unknown': 'Unknown gesture'
        };

        document.getElementById('current-gesture').textContent = gestureNames[this.currentGesture] || this.currentGesture;
    }

    updateVoiceStatus(listening) {
        const voiceStatus = document.getElementById('voice-status');
        if (listening) {
            voiceStatus.classList.remove('hidden');
        } else {
            voiceStatus.classList.add('hidden');
        }
    }

    drawFlowchart() {
        this.flowchartCtx.clearRect(0, 0, this.flowchartCanvas.width, this.flowchartCanvas.height);

        this.elements.forEach(element => {
            if (element.type === 'box') {
                this.drawBox(element);
            } else if (element.type === 'line') {
                this.drawLine(element);
            } else if (element.type === 'drawing') {
                this.drawFreeDrawing(element);
            }
        });

        // draw current free drawing path in real-time
        if (this.isFreeDrawing && this.freeDrawPath.length > 1) {
            this.drawFreeDrawPath(this.freeDrawPath);
        }
    }

    // we can style the boxes and lines here
    drawBox(box) {
        const ctx = this.flowchartCtx;

        ctx.fillStyle = 'rgba(0, 255, 136, 0.2)';
        ctx.fillRect(box.x, box.y, box.width, box.height);

        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        if (box.text) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;

            // word wrap!!
            const words = box.text.split(' ');
            const lines = [];
            let currentLine = '';

            words.forEach(word => {
                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);
                if (metrics.width > box.width - 10 && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            });
            if (currentLine) lines.push(currentLine);

            const lineHeight = 16;
            const totalHeight = lines.length * lineHeight;
            const startY = centerY - totalHeight / 2 + lineHeight / 2;

            lines.forEach((line, index) => {
                ctx.fillText(line, centerX, startY + index * lineHeight);
            });
        }
    }

    drawLine(line) {
        const ctx = this.flowchartCtx;

        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();

        const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
        const arrowLength = 15;
        const arrowAngle = Math.PI / 6;

        ctx.beginPath();
        ctx.moveTo(line.x2, line.y2);
        ctx.lineTo(
            line.x2 - arrowLength * Math.cos(angle - arrowAngle),
            line.y2 - arrowLength * Math.sin(angle - arrowAngle)
        );
        ctx.moveTo(line.x2, line.y2);
        ctx.lineTo(
            line.x2 - arrowLength * Math.cos(angle + arrowAngle),
            line.y2 - arrowLength * Math.sin(angle + arrowAngle)
        );
        ctx.stroke();
    }

    drawPath(path) {
        if (path.length < 2) return;

        const ctx = this.flowchartCtx;
        ctx.strokeStyle = 'rgba(255, 71, 87, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);

        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x, path[i].y);
        }

        ctx.stroke();
    }

    drawFreeDrawing(drawing) {
        if (drawing.path.length < 2) return;

        const ctx = this.flowchartCtx;
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(drawing.path[0].x, drawing.path[0].y);

        for (let i = 1; i < drawing.path.length; i++) {
            ctx.lineTo(drawing.path[i].x, drawing.path[i].y);
        }

        ctx.stroke();
    }

    drawFreeDrawPath(path) {
        if (path.length < 2) return;

        const ctx = this.flowchartCtx;
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.7)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);

        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x, path[i].y);
        }

        ctx.stroke();
    }

    drawCursor() {
        if (this.handPosition.x === 0 && this.handPosition.y === 0) return;

        const ctx = this.handsCtx;
        const x = this.handPosition.x;
        const y = this.handPosition.y;

        ctx.save();

        ctx.setTransform(1, 0, 0, 1, 0, 0);

        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ff4757';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x - 15, y);
        ctx.lineTo(x + 15, y);
        ctx.moveTo(x, y - 15);
        ctx.lineTo(x, y + 15);
        ctx.strokeStyle = '#ff4757';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (this.cursorElement) {
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);

            if (this.cursorElement.type === 'box') {
                ctx.strokeRect(
                    this.cursorElement.x - 2,
                    this.cursorElement.y - 2,
                    this.cursorElement.width + 4,
                    this.cursorElement.height + 4
                );
            } else if (this.cursorElement.type === 'line') {
                ctx.beginPath();
                ctx.moveTo(this.cursorElement.x1, this.cursorElement.y1);
                ctx.lineTo(this.cursorElement.x2, this.cursorElement.y2);
                ctx.stroke();
            }

            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    exportDiagram() {
        // create a temporary canvas for export
        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d');

        // calculate bounds of all elements
        if (this.elements.length === 0) {
            alert('No elements to export!');
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        this.elements.forEach(element => {
            if (element.type === 'box') {
                minX = Math.min(minX, element.x);
                minY = Math.min(minY, element.y);
                maxX = Math.max(maxX, element.x + element.width);
                maxY = Math.max(maxY, element.y + element.height);
            } else if (element.type === 'line') {
                minX = Math.min(minX, element.x1, element.x2);
                minY = Math.min(minY, element.y1, element.y2);
                maxX = Math.max(maxX, element.x1, element.x2);
                maxY = Math.max(maxY, element.y1, element.y2);
            } else if (element.type === 'drawing') {
                element.path.forEach(point => {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                });
            }
        });

        const padding = 20;
        const width = maxX - minX + 2 * padding;
        const height = maxY - minY + 2 * padding;

        exportCanvas.width = width;
        exportCanvas.height = height;

        // white background
        exportCtx.fillStyle = '#ffffff';
        exportCtx.fillRect(0, 0, width, height);

        // draw elements with offset
        this.elements.forEach(element => {
            if (element.type === 'box') {
                const box = {
                    ...element,
                    x: element.x - minX + padding,
                    y: element.y - minY + padding
                };
                this.drawBoxOnContext(exportCtx, box, true);
            } else if (element.type === 'line') {
                const line = {
                    ...element,
                    x1: element.x1 - minX + padding,
                    y1: element.y1 - minY + padding,
                    x2: element.x2 - minX + padding,
                    y2: element.y2 - minY + padding
                };
                this.drawLineOnContext(exportCtx, line, true);
            } else if (element.type === 'drawing') {
                const drawing = {
                    ...element,
                    path: element.path.map(point => ({
                        x: point.x - minX + padding,
                        y: point.y - minY + padding
                    }))
                };
                this.drawFreeDrawingOnContext(exportCtx, drawing, true);
            }
        });

        // download
        exportCanvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `autoboard-diagram-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    drawBoxOnContext(ctx, box, forExport = false) {
        ctx.fillStyle = forExport ? 'rgba(0, 100, 200, 0.1)' : 'rgba(0, 255, 136, 0.2)';
        ctx.fillRect(box.x, box.y, box.width, box.height);

        ctx.strokeStyle = forExport ? '#0066cc' : '#00ff88';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        if (box.text) {
            ctx.fillStyle = forExport ? '#000000' : '#ffffff';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;

            const words = box.text.split(' ');
            const lines = [];
            let currentLine = '';

            words.forEach(word => {
                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);
                if (metrics.width > box.width - 10 && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            });
            if (currentLine) lines.push(currentLine);

            const lineHeight = 16;
            const totalHeight = lines.length * lineHeight;
            const startY = centerY - totalHeight / 2 + lineHeight / 2;

            lines.forEach((line, index) => {
                ctx.fillText(line, centerX, startY + index * lineHeight);
            });
        }
    }

    drawLineOnContext(ctx, line, forExport = false) {
        ctx.strokeStyle = forExport ? '#0066cc' : '#00ff88';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();

        const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
        const arrowLength = 15;
        const arrowAngle = Math.PI / 6;

        ctx.beginPath();
        ctx.moveTo(line.x2, line.y2);
        ctx.lineTo(
            line.x2 - arrowLength * Math.cos(angle - arrowAngle),
            line.y2 - arrowLength * Math.sin(angle - arrowAngle)
        );
        ctx.moveTo(line.x2, line.y2);
        ctx.lineTo(
            line.x2 - arrowLength * Math.cos(angle + arrowAngle),
            line.y2 - arrowLength * Math.sin(angle + arrowAngle)
        );
        ctx.stroke();
    }

    drawFreeDrawingOnContext(ctx, drawing, forExport = false) {
        if (drawing.path.length < 2) return;

        ctx.strokeStyle = forExport ? '#0066cc' : '#00ff88';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(drawing.path[0].x, drawing.path[0].y);

        for (let i = 1; i < drawing.path.length; i++) {
            ctx.lineTo(drawing.path[i].x, drawing.path[i].y);
        }

        ctx.stroke();
    }

    clearAll() {
        if (confirm('Are you sure you want to clear all elements?')) {
            this.elements = [];
            this.finishCurrentAction();
            this.drawFlowchart();
        }
    }

    toggleGestureGuide() {
        const gestureGuide = document.querySelector('.gesture-guide');
        const gestureList = document.getElementById('gesture-list');
        const toggleBtn = document.getElementById('toggle-guide');

        if (gestureGuide && gestureList && toggleBtn) {
            gestureGuide.classList.toggle('minimized');
            const isMinimized = gestureGuide.classList.contains('minimized');
            toggleBtn.textContent = isMinimized ? '+' : '-';
        }
    }
}

// initialize the application when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new AutoBoard();
});


// easter egg 🥚
