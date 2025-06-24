import os
import io
import base64
import cv2 
import numpy as np 
from PIL import Image
from ultralytics import YOLO
from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates
from collections import defaultdict
from typing import List, Dict

# --- Configuración de rutas y modelo ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "best.pt")
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = BASE_DIR

app = FastAPI(
    title="MicroV - Análisis de Sedimento Urinario",
    description="API para la detección de elementos en sedimento urinario usando YOLOv8.",
    version="1.0.0"
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# --- Cargar el modelo YOLOv8 (una vez al iniciar la aplicación) ---
model = None
try:
    model = YOLO(MODEL_PATH)
    print(f"Modelo YOLOv8 cargado exitosamente desde: {MODEL_PATH}")
except Exception as e:
    print(f"ERROR: No se pudo cargar el modelo YOLOv8 desde {MODEL_PATH}. Asegúrate de que la ruta es correcta. Detalles: {e}")

# --- Ruta principal para servir el HTML ---
@app.get("/", response_class=HTMLResponse)
async def read_root():
    with open(os.path.join(TEMPLATES_DIR, "index.html"), "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content)

# --- Endpoint para la detección de imágenes (existente) ---
@app.post("/analyze_image/")
async def analyze_image(file: UploadFile = File(...)):
    if not model:
        raise HTTPException(status_code=500, detail="El modelo de detección no está cargado. Contacta al administrador.")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo subido no es una imagen.")

    try:
        image_bytes = await file.read()
        original_image = Image.open(io.BytesIO(image_bytes))

        results = model(original_image, save=False, conf=0.25, iou=0.7) 

        annotated_image_base64 = None
        class_counts = defaultdict(int)
        detailed_detections = []

        if results:
            first_result = results[0]
            annotated_image_np = first_result.plot()
            annotated_image_pil = Image.fromarray(annotated_image_np[..., ::-1]) 

            buffered = io.BytesIO()
            annotated_image_pil.save(buffered, format="PNG")
            annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

            if first_result.boxes:
                for box in first_result.boxes:
                    clase_id = int(box.cls)
                    nombre_clase = model.names[clase_id]
                    confianza = box.conf.item()
                    bbox = box.xyxy[0].tolist()

                    class_counts[nombre_clase] += 1
                    
                    detailed_detections.append({
                        "clase": nombre_clase,
                        "confianza": f"{confianza:.2f}",
                        "bbox": [round(coord) for coord in bbox]
                    })
        
        return {
            "status": "success",
            "annotated_image_base64": annotated_image_base64,
            "class_counts": dict(class_counts),
            "detailed_detections": detailed_detections
        }

    except Exception as e:
        print(f"Error interno durante el análisis de la imagen: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno al procesar la imagen: {e}")

@app.get("/download_annotated_image/")
async def download_annotated_image(image_data: str):
    try:
        image_bytes = base64.b64decode(image_data)
        return StreamingResponse(io.BytesIO(image_bytes), media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=400, detail="Datos de imagen base64 inválidos.")

# --- NUEVO: Endpoint WebSocket para stream de video en tiempo real ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Conexión WebSocket establecida con el cliente.")
    try:
        while True:
            # Esperar a recibir un mensaje (fotograma) del cliente
            # Asumimos que el cliente envía un string base64 de una imagen JPEG
            data = await websocket.receive_text()

            # Extraer los bytes de la imagen del string base64
            # Eliminar el prefijo "data:image/jpeg;base64," si existe
            if data.startswith("data:image/jpeg;base64,"):
                image_data = data.split(",")[1]
            elif data.startswith("data:image/png;base64,"):
                image_data = data.split(",")[1]
            else:
                image_data = data # Si solo se envía el base64 puro

            image_bytes = base64.b64decode(image_data)
            
            # Convertir bytes a un array numpy de OpenCV
            nparr = np.frombuffer(image_bytes, np.uint8)
            img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR) # Decodificar como imagen de color

            if img_np is None:
                print("Error al decodificar la imagen recibida. Saltando fotograma.")
                continue

            # Convertir de BGR (OpenCV) a RGB (YOLOv8 espera RGB o similar) si es necesario.
            # Ultralytics generalmente maneja esto internamente, pero si tienes problemas,
            # descomenta la siguiente línea:
            # img_rgb = cv2.cvtColor(img_np, cv2.COLOR_BGR2RGB)

            # Realizar inferencia con YOLOv8
            results = model(img_np, save=False, conf=0.25, iou=0.7, verbose=False) # verbose=False para menos logs en cada fotograma

            detections_to_send = []
            if results:
                first_result = results[0]
                if first_result.boxes:
                    for box in first_result.boxes:
                        clase_id = int(box.cls)
                        nombre_clase = model.names[clase_id]
                        confianza = box.conf.item()
                        bbox = box.xyxy[0].tolist() # [x1, y1, x2, y2]

                        detections_to_send.append({
                            "clase": nombre_clase,
                            "confianza": round(confianza, 2),
                            "bbox": [round(coord) for coord in bbox]
                        })
                
                # Opcional: Enviar también la imagen anotada de vuelta (puede ser pesado para tiempo real)
                # annotated_img_np = first_result.plot()
                # is_success, im_buf_arr = cv2.imencode(".jpg", annotated_img_np)
                # if is_success:
                #     annotated_img_base64 = base64.b64encode(im_buf_arr).decode('utf-8')
                #     # Puedes enviar esto junto con las detecciones, o por separado
                #     # Si lo envías junto, el frontend tiene que saber qué esperar
                #     # Para simplicidad inicial, solo enviamos los datos de las detecciones
            
            # Enviar los resultados de las detecciones de vuelta al cliente
            await websocket.send_json({"detections": detections_to_send})

    except WebSocketDisconnect:
        print("Cliente WebSocket desconectado.")
    except Exception as e:
        print(f"Error en el WebSocket: {e}")
    finally:
        await websocket.close()