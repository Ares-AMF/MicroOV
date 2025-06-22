# Usa una imagen base de Python que sea compatible con tus librerías
FROM python:3.11-slim-buster

# Instala las dependencias del sistema operativo que necesita OpenCV
# libgl1-mesa-glx para libGL.so.1
# libglib2.0-0 para libgthread-2.0.so.0
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1-mesa-glx libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copia el archivo requirements.txt al directorio de trabajo
COPY requirements.txt .

# Instala las dependencias de Python
RUN pip install --no-cache-dir -r requirements.txt

# Copia el resto de los archivos de tu aplicación al directorio de trabajo
COPY . .

# Expone el puerto que tu aplicación FastAPI va a usar
EXPOSE 8000

# Comando para iniciar la aplicación cuando el contenedor se ejecute
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
