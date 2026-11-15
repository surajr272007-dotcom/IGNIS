import os
import re
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

from typing import Union, Optional
from pydantic import field_validator

BASE_DIR = Path(__file__).resolve().parent.parent

# Explicitly load .env from BASE_DIR (backend/.env) and current working directory
load_dotenv(BASE_DIR / ".env")
load_dotenv(Path.cwd() / ".env")

class Settings(BaseSettings):
    APP_NAME: str = "IGNIS — Beyond the Hotspot"
    VERSION: str = "1.0.0"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    FIRMS_MAP_KEY: str = os.getenv("FIRMS_MAP_KEY", "")
    NASA_FIRMS_BASE_URL: str = os.getenv("NASA_FIRMS_BASE_URL", "https://firms.modaps.eosdis.nasa.gov")
    DUCKDB_PATH: str = os.getenv("DUCKDB_PATH", str(BASE_DIR / "ignis_warehouse.duckdb"))
    DATABASE_URL: Optional[str] = os.getenv("DATABASE_URL", None)
    CORS_ORIGINS: Union[list[str], str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000"
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, list[str]]) -> list[str]:
        if isinstance(v, str):
            if v.startswith("[") and v.endswith("]"):
                import json
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [i.strip() for i in v.split(",") if i.strip()]
        return v

    class Config:
        env_file = (str(BASE_DIR / ".env"), ".env")
        extra = "ignore"

settings = Settings()

def update_env_map_key(key: str):
    """Safely updates FIRMS_MAP_KEY in memory and writes to backend/.env and root .env."""
    clean_key = (key or "").strip()
    settings.FIRMS_MAP_KEY = clean_key
    os.environ["FIRMS_MAP_KEY"] = clean_key
    
    # Update in both backend/.env and root .env
    target_paths = [BASE_DIR / ".env", Path.cwd() / ".env"]
    for env_path in target_paths:
        try:
            if env_path.exists():
                content = env_path.read_text(encoding="utf-8")
                if "FIRMS_MAP_KEY=" in content:
                    new_content = re.sub(r"FIRMS_MAP_KEY=.*", f"FIRMS_MAP_KEY={clean_key}", content)
                else:
                    new_content = content.rstrip() + f"\nFIRMS_MAP_KEY={clean_key}\n"
                env_path.write_text(new_content, encoding="utf-8")
            else:
                env_path.write_text(f"FIRMS_MAP_KEY={clean_key}\n", encoding="utf-8")
        except Exception:
            pass

