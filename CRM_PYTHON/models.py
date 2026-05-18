from pydantic import BaseModel, Field, EmailStr

class Agente(BaseModel):
    nombre: str = Field(..., min_length=3)
    email: EmailStr
    rol: str = Field(default="agente")
    activo: bool = True
