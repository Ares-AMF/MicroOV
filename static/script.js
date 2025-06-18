// static/script.js - CONTEO Y DETALLES INDIVIDUALES

document.addEventListener('DOMContentLoaded', () => {
    const customUploader = document.getElementById('custom-file-uploader');
    const fileInput = document.getElementById('file-input');
    const browseButton = document.getElementById('browse-button'); // Initial reference
    const uploaderContent = document.getElementById('uploader-content');

    const resultsDisplay = document.getElementById('results-display');
    
    // Referencias para la tabla de CONTEO
    const countAnalysisDetailsSection = document.getElementById('count-analysis-details-section');
    const detectionsCountTableBody = document.getElementById('detections-count-table-body');
    const noDetectionsCountMessage = document.getElementById('no-detections-count-message');

    // Referencias para la tabla DETALLADA
    const detailedAnalysisDetailsSection = document.getElementById('detailed-analysis-details-section');
    const detectionsDetailedTableBody = document.getElementById('detections-detailed-table-body');
    const noDetectionsDetailedMessage = document.getElementById('no-detections-detailed-message');

    // Initial state for results section and tables
    function resetResultsDisplay() {
        resultsDisplay.innerHTML = `
            <p class="icon"><i class="fas fa-microscope"></i></p>
            <p class="main-text" id="results-message">Esperando análisis de la muestra</p>
            <p class="sub-text">Aquí aparecerán los elementos detectados.</p>
        `;
        // Ocultar ambas secciones de tabla y sus mensajes
        countAnalysisDetailsSection.style.display = 'none';
        if (noDetectionsCountMessage) noDetectionsCountMessage.style.display = 'none';

        detailedAnalysisDetailsSection.style.display = 'none';
        if (noDetectionsDetailedMessage) noDetectionsDetailedMessage.style.display = 'none';
    }
    resetResultsDisplay(); // Call it once to set initial state

    // --- Event Listeners for Custom Uploader ---

    // Highlight drag area
    customUploader.addEventListener('dragover', (e) => {
        e.preventDefault();
        customUploader.classList.add('drag-over');
    });

    customUploader.addEventListener('dragleave', (e) => {
        e.preventDefault();
        customUploader.classList.remove('drag-over');
    });

    // Handle file drop
    customUploader.addEventListener('drop', (e) => {
        e.preventDefault();
        customUploader.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        handleFile(file);
    });

    // Trigger file input on click of custom uploader area (excluding button)
    customUploader.addEventListener('click', (e) => {
        // Ensure the click isn't on the browse button itself or a child of it
        if (e.target.id !== 'browse-button' && e.target.closest('#browse-button') === null) {
            fileInput.click();
        }
    });

    // Function to attach click listener to browse button (needed because innerHTML recreates it)
    function attachBrowseButtonListener() {
        const currentBrowseButton = document.getElementById('browse-button');
        if (currentBrowseButton) {
            currentBrowseButton.onclick = (e) => {
                e.stopPropagation(); // Prevent the parent customUploader's click listener from also firing
                fileInput.click();
            };
        }
    }

    // Handle file selection via input
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        handleFile(file);
    });

    // --- File Processing and API Call ---
    async function handleFile(file) {
        if (!file) {
            clearUploader();
            resetResultsDisplay();
            return;
        }

        if (!file.type.startsWith('image/')) {
            alert('Por favor, sube un archivo de imagen (JPG/PNG).');
            clearUploader();
            resetResultsDisplay();
            return;
        }

        // Display image preview
        const reader = new FileReader();
        reader.onload = function(e) {
            uploaderContent.innerHTML = `
                <img id="image-preview" src="${e.target.result}" alt="Vista previa de imagen">
                <div id="file-name-display">${file.name} (${(file.size / 1024).toFixed(1)} KB)</div>
                <button class="browse-button" id="browse-button">Explorar archivos</button>
            `;
            // Re-attach event listener to the new browse button element because innerHTML overwrites it
            attachBrowseButtonListener();
        };
        reader.readAsDataURL(file);

        // Show loading state in results section
        resultsDisplay.innerHTML = `
            <div class="loading-spinner"></div>
            <p class="main-text" id="results-message">Analizando la imagen...</p>
        `;
        // Ocultar ambas secciones de tabla y sus mensajes mientras carga
        countAnalysisDetailsSection.style.display = 'none';
        if (noDetectionsCountMessage) noDetectionsCountMessage.style.display = 'none';
        detailedAnalysisDetailsSection.style.display = 'none';
        if (noDetectionsDetailedMessage) noDetectionsDetailedMessage.style.display = 'none';


        // Send file to FastAPI backend
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/analyze_image/', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (response.ok) {
                // Display annotated image
                if (data.annotated_image_base64) {
                    resultsDisplay.innerHTML = `<img id="results-image" src="data:image/png;base64,${data.annotated_image_base64}" alt="Elementos detectados">`;
                } else {
                    resultsDisplay.innerHTML = `
                        <p class="icon"><i class="fas fa-exclamation-triangle"></i></p>
                        <p class="main-text">No se pudo generar la imagen anotada.</p>
                        <p class="sub-text">Intenta subir la imagen de nuevo.</p>
                    `;
                }
                
                // --- Populate Count Table ---
                if (detectionsCountTableBody) {
                    detectionsCountTableBody.innerHTML = ''; // Clear previous results
                }
                const classCounts = data.class_counts;
                const hasCounts = Object.keys(classCounts).length > 0;

                if (hasCounts) {
                    countAnalysisDetailsSection.style.display = 'block'; // Show count table section
                    if (noDetectionsCountMessage) noDetectionsCountMessage.style.display = 'none';

                    // Sort classes alphabetically for consistent display
                    const sortedClasses = Object.keys(classCounts).sort();

                    sortedClasses.forEach(className => {
                        const count = classCounts[className];
                        const row = detectionsCountTableBody.insertRow();
                        row.insertCell().textContent = className;
                        row.insertCell().textContent = count;
                    });
                } else {
                    countAnalysisDetailsSection.style.display = 'block'; // Still show section to display 'no detections' message
                    if (noDetectionsCountMessage) noDetectionsCountMessage.style.display = 'block';
                    if (detectionsCountTableBody) detectionsCountTableBody.innerHTML = ''; // Ensure table is empty
                }

                // --- Populate Detailed Detections Table ---
                if (detectionsDetailedTableBody) {
                    detectionsDetailedTableBody.innerHTML = ''; // Clear previous results
                }
                const detailedDetections = data.detailed_detections;
                const hasDetailedDetections = detailedDetections && detailedDetections.length > 0;

                if (hasDetailedDetections) {
                    detailedAnalysisDetailsSection.style.display = 'block'; // Show detailed table section
                    if (noDetectionsDetailedMessage) noDetectionsDetailedMessage.style.display = 'none';
                    
                    // Sort detailed detections by class name for consistency
                    detailedDetections.sort((a, b) => a.clase.localeCompare(b.clase));

                    detailedDetections.forEach(detection => {
                        const row = detectionsDetailedTableBody.insertRow();
                        row.insertCell().textContent = detection.clase;
                        row.insertCell().textContent = detection.confianza;
                        row.insertCell().textContent = `[${detection.bbox.join(', ')}]`;
                    });
                } else {
                    detailedAnalysisDetailsSection.style.display = 'block'; // Show section to display 'no detections' message
                    if (noDetectionsDetailedMessage) noDetectionsDetailedMessage.style.display = 'block';
                    if (detectionsDetailedTableBody) detectionsDetailedTableBody.innerHTML = ''; // Ensure table is empty
                }

            } else {
                // Error handling: hide both tables
                resultsDisplay.innerHTML = `
                    <p class="icon"><i class="fas fa-exclamation-circle"></i></p>
                    <p class="main-text" id="results-message">Error: ${data.detail || 'Error desconocido'}</p>
                    <p class="sub-text">Intenta subir la imagen de nuevo.</p>
                `;
                countAnalysisDetailsSection.style.display = 'none';
                if (noDetectionsCountMessage) noDetectionsCountMessage.style.display = 'none';
                detailedAnalysisDetailsSection.style.display = 'none';
                if (noDetectionsDetailedMessage) noDetectionsDetailedMessage.style.display = 'none';
            }

        } catch (error) {
            console.error('Error al enviar la imagen:', error);
            resultsDisplay.innerHTML = `
                <p class="icon"><i class="fas fa-times-circle"></i></p>
                <p class="main-text" id="results-message">Error de conexión o red.</p>
                <p class="sub-text">Asegúrate de que el servidor está funcionando.</p>
            `;
            // Error handling: hide both tables
            countAnalysisDetailsSection.style.display = 'none';
            if (noDetectionsCountMessage) noDetectionsCountMessage.style.display = 'none';
            detailedAnalysisDetailsSection.style.display = 'none';
            if (noDetectionsDetailedMessage) noDetectionsDetailedMessage.style.display = 'none';
        }
    }

    // Function to reset the uploader to its initial state
    function clearUploader() {
        fileInput.value = ''; // Reset input
        uploaderContent.innerHTML = `
            <p class="icon"><i class="fas fa-cloud-upload-alt"></i></p>
            <p class="main-text">Arrastra y suelta tu imagen aquí</p>
            <p class="main-text">o haz clic para seleccionar</p>
            <p class="sub-text">Formatos soportados: JPG, PNG</p>
            <button class="browse-button" id="browse-button">Explorar archivos</button>
        `;
        // Re-attach event listener to the new browse button element
        attachBrowseButtonListener();
    }

    // Initialize uploader content on page load
    clearUploader();
});