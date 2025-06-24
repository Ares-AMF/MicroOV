document.addEventListener('DOMContentLoaded', () => {
    // Asegúrate de que estos IDs coincidan con los del HTML
    const videoElement = document.getElementById('videoElement');
    const canvasElement = document.getElementById('canvasElement');
    const context = canvasElement.getContext('2d');
    
    // Botones reubicados
    const startCameraButton = document.getElementById('start-camera-btn');
    const stopCameraButton = document.getElementById('stop-camera-btn');
    const toggleStreamButton = document.getElementById('toggle-stream-btn');

    // Elementos de estado y resultados
    const cameraStatusElement = document.getElementById('camera-status-inline'); // Nuevo ID
    const cameraDisplayContainer = document.querySelector('.camera-display-inline'); // Nuevo selector
    const realtimeResultsDiv = document.getElementById('realtime-results-inline'); // Nuevo ID
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
        // Nota: Si el video se muestra por debajo del canvas, NO LIMPIES.
        // Dibuja el fotograma del video en el canvas, luego las detecciones.
        // Si el video está en un elemento y el canvas encima, solo limpia las detecciones.
        
        // La implementación actual asume que el canvas DIBUJA el video + detecciones.
        // Es crucial que el video NO se muestre directamente sino a través del canvas
        // para que las detecciones se superpongan correctamente.
        // Asegúrate de que el videoElement esté visible o que se dibuje en el canvas.
        // Si el videoElement está `display: block` y el canvas `position: absolute` encima,
        // entonces el canvas es el que debe dibujar el video.
        
        // Primero, dibuja el fotograma actual del video en el canvas
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
            context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        } else {
            // Si el video no está listo, limpia el canvas para no mostrar detecciones antiguas
            context.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }

        detections.forEach(det => {
            const [x1, y1, x2, y2] = det.bbox;
            const label = `${det.clase} (${det.confianza})`;

            // Escalar las coordenadas si el canvas/video tienen un tamaño diferente al que esperas
            // Asegúrate que las coordenadas del backend están alineadas con la resolución que envías.
            // Si el canvas tiene el mismo tamaño que el videoElement.videoWidth/Height, no se necesita escala.
            // Si el CSS escala el video/canvas, las coordenadas de dibujo en el canvas serán relativas al tamaño del canvas.

            context.beginPath();
            context.rect(x1, y1, x2 - x1, y2 - y1); // Usar coords directas si no hay escalado o ya escalado
            context.lineWidth = 2;
            context.strokeStyle = 'lime'; // Un color que contraste con el fondo oscuro
            context.fillStyle = 'lime';
            context.stroke();

            context.font = '16px Arial';
            context.fillStyle = 'white'; // Texto blanco para la etiqueta
            // Ajustar la posición del texto para que no se salga por arriba si el bbox está muy arriba
            const textY = y1 > 20 ? y1 - 5 : y1 + 20; 
            context.fillText(label, x1 + 5, textY);
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
            const constraints = { 
                video: { 
                    facingMode: "environment",
                    width: { ideal: 640 }, // Pedir una resolución ideal para rendimiento
                    height: { ideal: 480 }
                } 
            };
            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            videoElement.srcObject = mediaStream;
            cameraStatusElement.textContent = "Cámara activa. Esperando iniciar detección...";
            cameraDisplayContainer.style.display = 'block'; // Mostrar el contenedor de video/canvas
            
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
        cameraDisplayContainer.style.display = 'none'; // Ocultar el contenedor de video/canvas
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
                // Dibujar el fotograma del video en el canvas antes de las detecciones
                if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
                    context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
                }
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
        if (!mediaStream || !streaming) {
             console.log("Deteniendo envío de frames: no hay stream o no se está haciendo streaming.");
             return;
        }

        // Obtener la imagen del canvas como Base64 (JPEG es más eficiente)
        // Asegúrate de que el videoElement.videoWidth y videoElement.videoHeight tienen valores
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            console.warn("Video no tiene dimensiones válidas. Reintentando...");
            animationFrameId = requestAnimationFrame(startSendingFrames);
            return;
        }

        // Antes de enviar, dibujamos el frame actual del video en el canvas.
        // Esto es crucial para que el canvas siempre tenga el frame más reciente.
        context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

        const imageDataURL = canvasElement.toDataURL('image/jpeg', 0.7); // Calidad 70%

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(imageDataURL);
        } else {
            console.warn("WebSocket no está abierto. No se enviarán fotogramas.");
            stopStreaming(); // Detener el streaming si el WS no está listo
            return;
        }

        // Programar el siguiente fotograma para la detección
        animationFrameId = requestAnimationFrame(startSendingFrames);
    }

    function stopStreaming() {
        streaming = false;
        toggleStreamButton.textContent = "Iniciar Detección";
        if (ws) {
            disconnectWebSocket(); // Cierra el WebSocket
        }
        cancelAnimationFrame(animationFrameId); // Detener el bucle de envío
        animationFrameId = null; // Reiniciar para el próximo inicio
        cameraStatusElement.textContent = "Cámara activa. Stream de detección detenido.";
        
        // Limpiar las detecciones dibujadas en el canvas, pero mantener el video
        // Es importante REDIBUJAR el fotograma del video después de limpiar,
        // para que solo se borren las cajas y el video siga viéndose.
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
            context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        } else {
            context.clearRect(0, 0, canvasElement.width, canvasElement.height); // Si no hay video, limpiar todo
        }
        realtimeResultsDiv.style.display = 'none'; // Ocultar resultados
        noRealtimeDetectionsMessage.style.display = 'none'; // Ocultar mensaje
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
            // Conectar el WebSocket e iniciar el envío de frames
            connectWebSocket(); 
        }
    });

    // Asegurarse de detener la cámara si el usuario cierra la página
    window.addEventListener('beforeunload', () => {
        stopCamera();
    });
});