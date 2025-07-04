# 1. IMAGEN BASE:
# Usamos una imagen oficial de PyTorch que ya incluye Python, CUDA y cuDNN.
# Esta es la misma imagen que RunPod usa en sus plantillas y es ideal para YOLOv8 con GPU.
# Asegúrate de que la versión de PyTorch/CUDA sea compatible con tu versión de YOLOv8.
FROM pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime

# 2. DIRECTORIO DE TRABAJO:
# Establece el directorio de trabajo dentro del contenedor.
WORKDIR /app

# 3. INSTALACIÓN DE DEPENDENCIAS DEL SISTEMA OPERATIVO:
# Aunque la imagen de PyTorch ya tiene muchas cosas, algunas librerías específicas de OpenCV
# para visualización pueden ser necesarias.
# libgl1-mesa-glx para libGL.so.1
# libglib2.0-0 para libgthread-2.0.so.0
# Nota: rm -rf /var/lib/apt/lists/* limpia el cache de apt para reducir el tamaño de la imagen.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1-mesa-glx libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# 4. COPIA DE DEPENDENCIAS E INSTALACIÓN DE PYTHON:
# Copiamos el archivo requirements.txt primero para aprovechar el cache de Docker.
COPY requirements.txt .

# Instala las dependencias de Python.
# Asegúrate de que tu requirements.txt incluya 'ultralytics', 'torch', 'torchvision',
# 'opencv-python', 'fastapi', 'uvicorn', etc.
# La imagen base ya tiene PyTorch, pero 'pip install -r' instalará las versiones
# especificadas o las que falten.
RUN pip install --no-cache-dir -r requirements.txt

# 5. COPIA DEL CÓDIGO DE LA APLICACIÓN:
# Copia el resto de los archivos de tu aplicación (incluyendo main.py, modelos, etc.)
# al directorio de trabajo dentro del contenedor.
COPY . .

# 6. EXPOSICIÓN DE PUERTO:
# Informa a Docker que la aplicación dentro del contenedor escuchará en este puerto.
EXPOSE 8000

# 7. COMANDO DE INICIO:
# Este es el comando que se ejecuta cuando el contenedor se inicia.
# Asegúrate de que tu aplicación FastAPI (main:app) esté lista para recibir solicitudes.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
