# SQL Predictor Web

Editor SQL con predicción de siguiente palabra 

## Estructura del proyecto

```text
sql-predictor-web/
├── index.html               # Estructura principal de la aplicación
├── css/
│   └── styles.css           # Hoja de estilos separada 
├── js/
│   ├── defaultCorpus.js     # Respaldo local del diccionario para uso sin servidor
│   ├── predictor.js         # Motor de tokenización, esquema y modelo N-grama
│   └── app.js               # Controlador del editor, popup y panel lateral
└── data/
    └── LLMFINETUNNING.txt   # Diccionario SQL 
```


## Atajos del editor

- `↑` / `↓`: Navegar entre predicciones
- `Tab` o `Enter`: Insertar la predicción seleccionada
- `Ctrl + Espacio`: Mostrar predicciones manualmente en la posición del cursor
- `Esc`: Cerrar menú de autocompletado
