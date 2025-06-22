# Usa una imagen base de Python que sea compatible con tus librerías
# python:3.11-slim-buster es una buena opción para Python 3.11 en un entorno ligero de Debian
FROM python:3.11-slim-buster

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copia el archivo requirements.txt al directorio de trabajo
COPY requirements.txt .

# Instala las dependencias de Python
# Esto usará la versión de Python especificada en la imagen base (3.11)
RUN pip install --no-cache-dir -r requirements.txt

# Copia el resto de los archivos de tu aplicación al directorio de trabajo
# Esto copiará main.py, static/, best.pt, etc.
COPY . .

# Expone el puerto que tu aplicación FastAPI va a usar
EXPOSE 8000

# Comando para iniciar la aplicación cuando el contenedor se ejecute
# Asegúrate de que tu main.py esté en la raíz del WORKDIR /app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
