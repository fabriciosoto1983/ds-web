# dssolucionesacademicas.net

Sitio de DS Soluciones Académicas. El contenido del blog y de la biblioteca de
recursos vive en una hoja de Google Sheets; este repositorio lo convierte en
páginas HTML reales antes de publicar.

## Cómo publicar

1. Abres la hoja de cálculo y escribes una fila nueva.
2. Pones `SI` en la columna `publicado`.
3. Ya está.

El sitio se regenera solo cada mañana a las 06:00 de Ecuador. Si tienes prisa,
entra a la pestaña **Actions** de este repositorio, elige *Actualizar el sitio
desde la hoja* y pulsa **Run workflow**. Tarda alrededor de un minuto.

## Qué hay aquí

| Archivo | Para qué sirve |
|---|---|
| `build.mjs` | Lee la hoja y escribe las páginas. Es el corazón del sistema |
| `src/estilos.css` | Los estilos del sitio, compartidos por todas las páginas |
| `sitio/` | Lo que se publica. `index.html` y `herramientas/` son fijos |
| `netlify.toml` | Configuración de despliegue y redirecciones |
| `.github/workflows/` | La tarea que regenera el sitio cada día |

Las carpetas `sitio/blog/` y `sitio/recursos/` no están en el repositorio
porque se generan en cada despliegue. No hace falta subirlas.

## La hoja de cálculo

Tiene dos pestañas que alimentan el sitio.

**Blog** produce `/blog/` y una página por artículo.
Columnas: `titulo`, `fecha`, `contenido`, `video`, `publicado`, `categoria`.

**Recursos** produce `/recursos/` y una ficha por documento.
Columnas: `titulo`, `fecha`, `descripcion`, `categoria`, `nivel`,
`asignatura`, `anio`, `enlace`, `formato`, `publicado`.

## Formato del texto

Dentro de `contenido` y `descripcion` puedes usar:

```
## Subtítulo
### Subtítulo menor

Un párrafo normal. Con **negrita**, _cursiva_ y [enlaces](https://ejemplo.com).

- Punto de lista
- Otro punto

1. Primer paso
2. Segundo paso

> Bloque de aviso destacado sobre fondo azul.

| Columna | Otra |
| Dato    | Dato |

![Texto alternativo](https://url-de-la-imagen.jpg)

{{descarga:https://drive.google.com/file/d/ID/view|Descargar el formato}}
```

Para saltar de línea dentro de una celda de Google Sheets: **Alt + Enter**.

## Probar en tu computadora

Solo si alguna vez quieres verlo antes de publicar. Necesitas Node 22.

```bash
node build.mjs
npx serve sitio
```

## Si algo falla

Entra a **Actions**, abre la ejecución que salió en rojo y lee el error. Los
dos habituales:

- *La pestaña no existe o la hoja no es pública*: revisa que la hoja siga
  compartida como "Cualquier persona con el enlace · Lector".
- *Falta la columna titulo*: alguien renombró o borró la fila de encabezados.
