Estos son los comandos para preparar el entorno virtual y correr la app

python -m venv venv_microov_deploy 

.\venv_microov_deploy\Scripts\activate
DESPUES DE EJECUTAR EL SIGUIENTE COMANDO DEBERIAS VER ESTO EN LA TERMINAL
(venv_microov_deploy) PS C:\Users\TúUsuario\OneDrive\Desktop\MicroOV_Deployment>

pip install numpy==1.26.4

REVISA requirements.txt ANTES DE CONTINUAR

pip install -r requirements.txt

uvicorn main:app --host 127.0.0.1 --port 8000

- Ares