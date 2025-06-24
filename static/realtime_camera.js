document.addEventListener('DOMContentLoaded', () => {
    const videoElement = document.getElementById('videoElement');
    const canvasElement = document.getElementById('canvasElement');
    const context = canvasElement.getContext('2d');
    const startCameraButton = document.getElementById('start-camera-btn');
    const stopCameraButton = document.getElementById('stop-camera-btn');
    const toggleStreamButton = document.getElementById('toggle-stream-btn');
    const cameraStatusElement = document.getElementById('camera-status');
    const realtimeResultsDiv = document.getElementById('realtime-results');
    const realtimeCountTableBody = document.getElementById('realtime-count-table-body');
    const noRealtimeDetectionsMessage = document.getElementById('no-realtime-detections');

    let mediaStream = null;
    let ws = null;
    let streaming = false; // Estado para controlar si estamos enviando fotogramas al servidor
    let animationFrameId = null; // Para controlar el bucle de requestAnimationFrame

    // --- Funciones de Utilidad ---

    // Función para dibujar los bounding boxes y etiquetas
    function drawDetections(detections) {
        // Limpiar el canvas antes de dibujar el nuevo fotograma y las detecciones
        context.clearRect(0, 0, canvasElement.width, canvasElement.height);
        
        // Es importante dibujar el fotograma de video actual ANTES de las detecciones
        // Asegúrate de que el video está listo y tiene dimensiones
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
            context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        }

        detections.forEach(det => {
            const [x1, y1, x2, y2] = det.bbox;
            const label = `${det.clase} (${det.confianza})`;

            // Escalar las coordenadas si el canvas tiene un tamaño diferente al del video
            // Asumimos que el backend envía las coordenadas relativas al tamaño original del video
            // Si el backend envía coordenadas basadas en la imagen enviada, y el video/canvas tienen la misma proporción,
            // esta escala es directa. Si no, se necesita un cálculo más complejo.
            const scaleX = canvasElement.width / videoElement.videoWidth;
            const scaleY = canvasElement.height / videoElement.videoHeight;

            const scaledX1 = x1 * scaleX;
            const scaledY1 = y1 * scaleY;
            const scaledX2 = x2 * scaleX;
            const scaledY2 = y2 * scaleY;

            context.beginPath();
            context.rect(scaledX1, scaledY1, scaledX2 - scaledX1, scaledY2 - scaledY1);
            context.lineWidth = 2;
            context.strokeStyle = 'red';
            context.fillStyle = 'red';
            context.stroke();

            context.font = '14px Arial';
            context.fillText(label, scaledX1, scaledY1 > 10 ? scaledY1 - 5 : 10);
        });
    }

    // Función para actualizar la tabla de conteo
    function updateCountTable(detections) {
        realtimeCountTableBody.innerHTML = ''; // Limpiar tabla
        const counts = {};
        detections.forEach(det => {
            counts[det.clase] = (counts[det.clase] || 0) + 1;
        });

        if (Object.keys(counts).length === 0) {
            noRealtimeDetectionsMessage.style.display = 'block';
            realtimeCountTableBody.innerHTML = '<tr><td colspan="2">No se detectaron objetos.</td></tr>';
        } else {
            noRealtimeDetectionsMessage.style.display = 'none';
            for (const clase in counts) {
                const row = realtimeCountTableBody.insertRow();
                const cellClass = row.insertCell();
                const cellCount = row.insertCell();
                cellClass.textContent = clase;
                cellCount.textContent = counts[clase];
            }
        }
        realtimeResultsDiv.style.display = 'block';
    }

    // --- Funciones de Cámara ---

    async function startCamera() {
        if (mediaStream) {
            console.warn("Cámara ya iniciada.");
            return;
        }

        try {
            // Preferir la cámara trasera ("environment")
            const constraints = { video: { facingMode: "environment" } };
            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            videoElement.srcObject = mediaStream;
            cameraStatusElement.textContent = "Cámara activa. Esperando iniciar detección...";
            
            // Cuando el video cargue, ajustar el tamaño del canvas
            videoElement.onloadedmetadata = () => {
                canvasElement.width = videoElement.videoWidth;
                canvasElement.height = videoElement.videoHeight;
                console.log(`Video dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                console.log(`Canvas dimensions: ${canvasElement.width}x${canvasElement.height}`);
            };

            startCameraButton.disabled = true;
            stopCameraButton.disabled = false;
            toggleStreamButton.disabled = false;
        } catch (err) {
            console.error("Error al acceder a la cámara:", err);
            cameraStatusElement.textContent = `Error: ${err.message}. Asegúrate de permitir el acceso a la cámara.`;
            alert(`Error al acceder a la cámara: ${err.message}.`);
        }
    }

    function stopCamera() {
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        videoElement.srcObject = null;
        cameraStatusElement.textContent = "Cámara detenida.";
        startCameraButton.disabled = false;
        stopCameraButton.disabled = true;
        toggleStreamButton.disabled = true;
        stopStreaming(); // Asegurarse de detener el streaming también
        realtimeResultsDiv.style.display = 'none'; // Ocultar resultados
        context.clearRect(0, 0, canvasElement.width, canvasElement.height); // Limpiar canvas
    }

    // --- Funciones de WebSocket y Streaming ---

    function connectWebSocket() {
        // Usa `window.location.origin` para obtener el dominio actual (http://localhost:8000 o https://your-app.onrender.com)
        // Y luego reemplaza `http` por `ws` o `https` por `wss`
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        ws = new WebSocket(wsUrl);

        ws.onopen = (event) => {
            console.log("WebSocket abierto.");
            cameraStatusElement.textContent = "Cámara activa. Stream de detección iniciado.";
            streaming = true;
            toggleStreamButton.textContent = "Detener Detección";
            startSendingFrames();
        };

        ws.onmessage = (event) => {
            const response = JSON.parse(event.data);
            if (response && response.detections) {
                drawDetections(response.detections);
                updateCountTable(response.detections);
            }
        };

        ws.onclose = (event) => {
            console.log("WebSocket cerrado.", event);
            cameraStatusElement.textContent = "Cámara activa. Stream de detección detenido. (WebSocket cerrado)";
            streaming = false;
            toggleStreamButton.textContent = "Iniciar Detección";
            cancelAnimationFrame(animationFrameId); // Detener el bucle de envío
            // Opcional: Reintentar conexión si se cierra inesperadamente
        };

        ws.onerror = (error) => {
            console.error("Error en WebSocket:", error);
            cameraStatusElement.textContent = `Cámara activa. Error en la detección: ${error.message}`;
            streaming = false;
            toggleStreamButton.textContent = "Iniciar Detección";
            cancelAnimationFrame(animationFrameId); // Detener el bucle de envío
        };
    }

    function disconnectWebSocket() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        ws = null;
    }

    function startSendingFrames() {
        if (!mediaStream || !streaming) return;

        // Limpiar canvas y dibujar el fotograma actual del video
        context.clearRect(0, 0, canvasElement.width, canvasElement.height);
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
            context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        }

        // Obtener la imagen del canvas como Base64 (JPEG es más eficiente)
        const imageDataURL = canvasElement.toDataURL('image/jpeg', 0.7); // Calidad 70%

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(imageDataURL);
        } else {
            console.warn("WebSocket no está abierto. No se enviarán fotogramas.");
            stopStreaming(); // Detener el streaming si el WS no está listo
            return;
        }

        // Programar el siguiente fotograma para la detección
        // Usar setTimeout para controlar la tasa de frames (ej. 100ms = 10 FPS)
        // o requestAnimationFrame para una experiencia más fluida y sincronizada con el navegador
        animationFrameId = requestAnimationFrame(startSendingFrames);
    }

    function stopStreaming() {
        streaming = false;
        toggleStreamButton.textContent = "Iniciar Detección";
        if (ws) {
            disconnectWebSocket(); // Cierra el WebSocket
        }
        cancelAnimationFrame(animationFrameId); // Detener el bucle de envío
        cameraStatusElement.textContent = "Cámara activa. Stream de detección detenido.";
        // Limpiar las detecciones dibujadas en el canvas, pero mantener el video
        context.clearRect(0, 0, canvasElement.width, canvasElement.height);
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
             context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        }
        realtimeResultsDiv.style.display = 'none'; // Ocultar resultados
    }

    // --- Event Listeners ---

    startCameraButton.addEventListener('click', startCamera);
    stopCameraButton.addEventListener('click', stopCamera);

    toggleStreamButton.addEventListener('click', () => {
        if (streaming) {
            stopStreaming();
        } else {
            // Antes de iniciar el streaming, asegurar que la cámara esté activa
            if (!mediaStream) {
                alert("Por favor, inicia la cámara primero.");
                return;
            }
            connectWebSocket(); // Esto iniciará el streaming en el onopen
        }
    });

    // Asegurarse de detener la cámara si el usuario cierra la página
    window.addEventListener('beforeunload', () => {
        stopCamera();
    });
});
