import os
import io
import base64
import cv2 
import numpy as np 
from PIL import Image
from ultralytics import YOLO
from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates
from collections import defaultdict
from typing import List, Dict

# --- Configuración de rutas y modelo ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Asegúrate de que 'best.pt' esté en la misma carpeta que main.py en tu repositorio de GitHub
MODEL_PATH = os.path.join(BASE_DIR, "best.pt") 
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = BASE_DIR # Si index.html está en la raíz junto a main.py

app = FastAPI(
    title="MicroV - Análisis de Sedimento Urinario",
    description="API para la detección de elementos en sedimento urinario usando YOLOv8.",
    version="1.0.0"
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# --- Cargar el modelo YOLOv8 (una vez al iniciar la aplicación) ---
# Usamos una variable global para el modelo
global model 
model = None 

@app.on_event("startup")
async def startup_event():
    global model
    print("INFO: === Iniciando la aplicación FastAPI ===")
    print(f"INFO: Ruta base del proyecto: {BASE_DIR}")
    print(f"INFO: Intentando cargar el modelo desde: {MODEL_PATH}")
    
    # Verificar si el archivo del modelo existe antes de intentar cargarlo
    if not os.path.exists(MODEL_PATH):
        print(f"ERROR: ¡El archivo del modelo no se encontró en la ruta especificada: {MODEL_PATH}!")
        print("ERROR: Asegúrate de que 'best.pt' está en la raíz de tu repositorio de GitHub.")
        # Opcional: podrías raise HTTPException aquí para que el despliegue falle si el modelo no está
        # raise HTTPException(status_code=500, detail=f"Modelo no encontrado en {MODEL_PATH}")
        return # Salir si el modelo no existe

    try:
        model = YOLO(MODEL_PATH)
        print(f"SUCCESS: Modelo YOLOv8 cargado exitosamente desde: {MODEL_PATH}")
        
        # Opcional: Una pequeña prueba de inferencia para asegurar que el modelo está funcional
        try:
            test_img_np = np.zeros((640, 640, 3), dtype=np.uint8) # Imagen de prueba en blanco
            _ = model(test_img_np, verbose=False, conf=0.01) # conf baja para evitar detecciones falsas
            print("INFO: Prueba de inferencia inicial del modelo completada sin errores.")
        except Exception as e:
            print(f"ADVERTENCIA: La prueba de inferencia inicial falló, pero el modelo cargó. Error: {e}")

    except Exception as e:
        print(f"CRITICAL ERROR: Fallo al cargar el modelo YOLOv8 desde {MODEL_PATH}. Detalles: {e}")
        # Aquí puedes decidir si quieres que la aplicación falle completamente al cargar o continúe con un modelo nulo
        # Para despliegues en producción, es mejor que falle aquí si el modelo es esencial
        # raise e 

@app.on_event("shutdown")
async def shutdown_event():
    print("INFO: === Cerrando la aplicación FastAPI ===")
    global model
    if model:
        # Aquí puedes liberar recursos si YOLOv8 tuviera un método específico,
        # aunque generalmente no es necesario para modelos cargados en memoria.
        pass

# --- Ruta principal para servir el HTML ---
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request): # Añadido request para compatibilidad con Jinja2Templates
    return templates.TemplateResponse("index.html", {"request": request})

# --- Endpoint para la detección de imágenes (existente) ---
@app.post("/analyze_image/")
async def analyze_image(file: UploadFile = File(...)):
    if model is None: # Usar 'is None' es más robusto que solo 'not model'
        print("ERROR: analyze_image: El modelo de detección no está cargado.")
        raise HTTPException(status_code=500, detail="El modelo de detección no está cargado. Contacta al administrador.")

    if not file.content_type.startswith("image/"):
        print(f"ERROR: analyze_image: Tipo de archivo no permitido: {file.content_type}")
        raise HTTPException(status_code=400, detail="El archivo subido no es una imagen.")

    try:
        image_bytes = await file.read()
        original_image = Image.open(io.BytesIO(image_bytes))

        # Configura verbose=False para reducir la verbosidad de YOLO en los logs de Render
        results = model(original_image, save=False, conf=0.25, iou=0.7, verbose=False) 

        annotated_image_base64 = None
        class_counts = defaultdict(int)
        detailed_detections = []

        if results and len(results) > 0: # Asegúrate de que hay resultados
            first_result = results[0]
            # Convertir a numpy array y luego a PIL Image
            annotated_image_np = first_result.plot() # YOLOv8 plot devuelve un numpy array (BGR)
            # Convertir BGR a RGB para PIL si la imagen se ve con colores invertidos
            annotated_image_pil = Image.fromarray(cv2.cvtColor(annotated_image_np, cv2.COLOR_BGR2RGB)) 

            buffered = io.BytesIO()
            annotated_image_pil.save(buffered, format="PNG")
            annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

            if first_result.boxes:
                for box in first_result.boxes:
                    clase_id = int(box.cls)
                    # Asegúrate de que model.names esté accesible y sea correcto
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
        print(f"ERROR: Error interno durante el análisis de la imagen por /analyze_image/: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno al procesar la imagen: {e}")

@app.get("/download_annotated_image/")
async def download_annotated_image(image_data: str):
    try:
        image_bytes = base64.b64decode(image_data)
        return StreamingResponse(io.BytesIO(image_bytes), media_type="image/png")
    except Exception as e:
        print(f"ERROR: download_annotated_image: Datos de imagen base64 inválidos. Error: {e}")
        raise HTTPException(status_code=400, detail="Datos de imagen base64 inválidos.")

# --- Endpoint WebSocket para stream de video en tiempo real ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("INFO: WebSocket: Cliente conectado. Esperando fotogramas...")
    try:
        # Asegurarse de que el modelo esté cargado antes de intentar usarlo
        if model is None:
            print("ERROR: WebSocket: El modelo de detección no está cargado. Cerrando conexión.")
            await websocket.close(code=1011) # Código de error para 'internal error'
            return

        while True:
            try:
                data = await websocket.receive_text()
                # print("DEBUG: WebSocket: Fotograma recibido (tipo texto).")

                # Extraer los bytes de la imagen del string base64
                if "," in data: # Comprobar si tiene el prefijo de datos
                    image_data = data.split(",")[1]
                else:
                    image_data = data # Si solo se envía el base64 puro

                image_bytes = base64.b64decode(image_data)
                
                # Convertir bytes a un array numpy de OpenCV
                nparr = np.frombuffer(image_bytes, np.uint8)
                img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR) 

                if img_np is None:
                    print("ADVERTENCIA: WebSocket: No se pudo decodificar la imagen recibida. Saltando fotograma.")
                    continue

                # --- OPTIMIZACIÓN CRÍTICA AQUÍ ---
                # Reducir las dimensiones de la imagen al 25% del original
                # Esto es crucial para el rendimiento en entornos con recursos limitados.
                # Asegúrate de que las dimensiones resultantes no sean cero o muy pequeñas.
                new_width = img_np.shape[1] // 4
                new_height = img_np.shape[0] // 4
                
                if new_width == 0 or new_height == 0:
                    print("ADVERTENCIA: WebSocket: Dimensiones de imagen después de redimensionar son cero. Saltando fotograma.")
                    continue
                
                resized_img_np = cv2.resize(img_np, (new_width, new_height))

                # print("DEBUG: WebSocket: Imagen redimensionada y lista para inferencia.")
                # Realizar inferencia con YOLOv8
                # conf=0.5: Solo reporta detecciones con al menos 50% de confianza. Reduce ruido y procesamiento.
                # iou=0.5: Umbral de Non-Maximum Suppression.
                # device="cpu": Fuerza la ejecución en CPU. Es clave para Render Free Tier.
                # verbose=False: Reduce los logs de YOLOv8 para no saturar Render.
                results = model(resized_img_np, save=False, conf=0.5, iou=0.5, verbose=False, device="cpu") 
                # print("DEBUG: WebSocket: Inferencia de YOLOv8 completada.")

                detections_to_send = []
                if results and len(results) > 0:
                    first_result = results[0]
                    if first_result.boxes: # Asegurarse de que hay boxes detectados
                        for box in first_result.boxes:
                            clase_id = int(box.cls)
                            # Asegúrate de que model.names contiene todas las clases esperadas
                            if clase_id < len(model.names):
                                nombre_clase = model.names[clase_id]
                            else:
                                nombre_clase = f"Clase_{clase_id}" # Fallback si el ID no se encuentra
                            
                            confianza = box.conf.item()
                            bbox = box.xyxy[0].tolist() # [x1, y1, x2, y2]

                            detections_to_send.append({
                                "clase": nombre_clase,
                                "confianza": round(confianza, 2),
                                "bbox": [round(coord) for coord in bbox]
                            })
                
                # Enviar los resultados de las detecciones de vuelta al cliente
                await websocket.send_json({"detections": detections_to_send})
                # print(f"DEBUG: WebSocket: Detecciones enviadas: {len(detections_to_send)} objetos.")

            except WebSocketDisconnect:
                print("INFO: WebSocket: Cliente se ha desconectado limpiamente.")
                break # Sale del bucle while True
            except Exception as e:
                print(f"ERROR: WebSocket: Error en el procesamiento del fotograma o envío: {e}")
                # Si hay un error grave en un fotograma, intentamos cerrar la conexión para evitar bucles de errores
                await websocket.close(code=1011) # Código de error 'internal error'
                break # Salir del bucle

    except WebSocketDisconnect:
        print("INFO: WebSocket: Cliente se ha desconectado limpiamente (fuera del bucle).")
    except Exception as e:
        print(f"ERROR: WebSocket: Error general al establecer/manejar la conexión: {e}")
    finally:
        print("INFO: WebSocket: Conexión cerrada.")