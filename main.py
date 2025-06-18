import os
import io
import base64
from PIL import Image
from ultralytics import YOLO
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates # Aunque no la usas directamente, la mantengo si planeas usar Jinja2 templates
from collections import defaultdict
from typing import List, Dict

# --- Configuración de rutas y modelo ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# *** CAMBIO IMPORTANTE AQUÍ ***
# El modelo best.pt y data.yaml ahora están directamente en BASE_DIR
MODEL_PATH = os.path.join(BASE_DIR, "best.pt")
DATA_YAML_PATH = os.path.join(BASE_DIR, "data.yaml") # Añadido para cargar los nombres de las clases si YOLO no lo hace automáticamente.

STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = BASE_DIR # Asumiendo que index.html está en la raíz de MicroOV_Deployment

app = FastAPI(
    title="MicroV - Análisis de Sedimento Urinario",
    description="API para la detección de elementos en sedimento urinario usando YOLOv8.",
    version="1.0.0"
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR) # Se mantiene Jinja2Templates aunque sirves HTML directo

# --- Cargar el modelo YOLOv8 (una vez al iniciar la aplicación) ---
model = None
try:
    model = YOLO(MODEL_PATH)
    print(f"Modelo YOLOv8 cargado exitosamente desde: {MODEL_PATH}")
    
    # Opcional: Cargar nombres de clases desde data.yaml si el modelo no los carga automáticamente
    # (YOLO.names debería ser suficiente, pero esto es un fallback o para depuración)
    # import yaml
    # with open(DATA_YAML_PATH, 'r') as f:
    #     data_config = yaml.safe_load(f)
    #     # Asegúrate de que model.names esté bien poblado o usa data_config['names']
    #     # si el modelo no carga las clases correctamente.
    #     # model.names = data_config['names'] # Descomenta si necesitas forzar la carga así
    
except Exception as e:
    print(f"ERROR: No se pudo cargar el modelo YOLOv8 desde {MODEL_PATH}. Asegúrate de que la ruta es correcta. Detalles: {e}")
    # Considera una salida más robusta aquí, como sys.exit(1) en un entorno de producción

# --- Ruta principal para servir el HTML ---
@app.get("/", response_class=HTMLResponse)
async def read_root():
    # Asegúrate de que index.html esté en la raíz de MicroOV_Deployment
    index_html_path = os.path.join(TEMPLATES_DIR, "index.html")
    if not os.path.exists(index_html_path):
        raise HTTPException(status_code=500, detail="index.html no encontrado en la ruta esperada.")
    with open(index_html_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content)

# --- Endpoint para la detección de imágenes ---
@app.post("/analyze_image/")
async def analyze_image(file: UploadFile = File(...)):
    if not model:
        raise HTTPException(status_code=500, detail="El modelo de detección no está cargado. Contacta al administrador.")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo subido no es una imagen.")

    try:
        image_bytes = await file.read()
        original_image = Image.open(io.BytesIO(image_bytes))

        # Realizar la inferencia con YOLOv8
        # conf=0.25 y iou=0.7 son los umbrales de confianza y IoU, puedes ajustarlos si es necesario.
        results = model(original_image, save=False, conf=0.25, iou=0.7)

        annotated_image_base64 = None
        class_counts = defaultdict(int) # Para la tabla de conteo
        detailed_detections = []        # Para la tabla de detalles

        if results:
            # Obtener la imagen anotada
            # results[0].plot() devuelve un array numpy (BGR), Image.fromarray espera RGB
            # El [..., ::-1] es para convertir de BGR a RGB
            annotated_image_np = results[0].plot()
            annotated_image_pil = Image.fromarray(annotated_image_np[..., ::-1])

            buffered = io.BytesIO()
            annotated_image_pil.save(buffered, format="PNG")
            annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

            # Recopilar datos de las detecciones
            for r in results:
                if r.boxes:
                    for box in r.boxes:
                        clase_id = int(box.cls)
                        # model.names debería contener los nombres de las clases cargados desde best.pt
                        # Si tienes problemas, puedes forzar la carga de data.yaml y usar data_config['names'][clase_id]
                        nombre_clase = model.names[clase_id] 
                        confianza = box.conf.item()
                        bbox = box.xyxy[0].tolist()

                        # Para la tabla de conteo
                        class_counts[nombre_clase] += 1
                        
                        # Para la tabla de detalles
                        detailed_detections.append({
                            "clase": nombre_clase,
                            "confianza": f"{confianza:.2f}",
                            "bbox": [round(coord) for coord in bbox] # Redondea coordenadas para limpieza
                        })
        
        return {
            "status": "success",
            "annotated_image_base64": annotated_image_base64,
            "class_counts": dict(class_counts), # Convertir defaultdict a dict para JSON
            "detailed_detections": detailed_detections # Enviar la lista de detalles
        }

    except Exception as e:
        # Registra el error completo para depuración en un entorno real
        print(f"Error durante el procesamiento: {e}") 
        raise HTTPException(status_code=500, detail=f"Error interno al procesar la imagen: {e}")

# --- Endpoint para la descarga de imagen anotada (sin cambios) ---
@app.get("/download_annotated_image/")
async def download_annotated_image(image_data: str):
    try:
        image_bytes = base64.b64decode(image_data)
        return StreamingResponse(io.BytesIO(image_bytes), media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=400, detail="Datos de imagen base64 inválidos.")