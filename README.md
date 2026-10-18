# CityPulse AI

## Run locally

The dashboard stays a static frontend. Its AI waste scanner sends images to the local FastAPI service; no API key or cloud AI service is used.

1. Open a terminal in the `CityPulseAI` folder and start the backend:

   ```powershell
   cd backend
   python -m pip install -r requirements.txt
   python -m uvicorn main:app --reload
   ```

2. Open a second terminal in the `CityPulseAI` folder and serve the frontend:

   ```powershell
   cd frontend
   python -m http.server 5500
   ```

3. Open <http://127.0.0.1:5500> and choose **AI waste scanner**. Check `http://127.0.0.1:8000/api/vision/status` for vision dependency readiness; the API docs are at <http://127.0.0.1:8000/docs>.

The first image analysis downloads the pretrained YOLO-World weights and can take longer. Internet access is required for this download, but no API key is needed. The models suggest visible object categories; review results manually. Waste detection runs independently from fill estimation. A generic pretrained detector does not reliably estimate bin fill. Fill changes only when a selected bin receives a recognized fill class from a configured custom fill model.

## Backend and vision

- `backend/main.py` provides the dashboard API, demo operations, and `POST /api/vision/analyze`.
- `computer vision/vision.py` estimates fill only for recognized fill-class labels.
- `computer vision/waste_vision.py` detects prompted waste categories with YOLO-World.
- Set `CITYPULSE_YOLO_MODEL` or `CITYPULSE_WASTE_MODEL` to local model file paths to use local weights.

Bin, fleet, and collection records currently live in backend memory and reset when the server restarts. The dashboard's fleet routing and telemetry remain labeled as demonstration data.
