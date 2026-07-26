/* ===========================================================================
   build.mjs · Generador de páginas de DS Soluciones Académicas

   Lee las pestañas "Blog" y "Recursos" de la hoja de cálculo y escribe un
   archivo HTML real por cada artículo y por cada documento. El texto queda
   dentro del HTML, así que Google y los buscadores de IA lo leen sin
   ejecutar JavaScript.

   Se ejecuta solo. No hay que tocarlo.
   =========================================================================== */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  Configuración                                                      */
/* ------------------------------------------------------------------ */

const CONFIG = {
  hoja: '1pHDYkBZ2mR-rYeZnXXS_HRb97GBiQgLcguoqEiu5Q-I',
  pestanaBlog: 'Blog',
  pestanaRecursos: 'Recursos',
  base: 'https://www.dssolucionesacademicas.net',
  salida: 'sitio',
  telefono: '593989074861',
  autor: 'Diego Fabricio Soto Roa'
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/* ------------------------------------------------------------------ */
/*  Utilidades                                                         */
/* ------------------------------------------------------------------ */

const norm = s => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 70);

function parseCSV(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const filas = []; let fila = [], campo = '', comillas = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (comillas) {
      if (c === '"') {
        if (text[i + 1] === '"') { campo += '"'; i += 2; continue; }
        comillas = false; i++; continue;
      }
      campo += c; i++; continue;
    }
    if (c === '"') { comillas = true; i++; continue; }
    if (c === ',') { fila.push(campo); campo = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; i++; continue; }
    campo += c; i++;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

function parseFecha(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^Date\((\d+),(\d+),(\d+)/);
  if (m) return new Date(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m.map(Number);
    if (y < 100) y += 2000;
    let dia = a, mes = b;
    if (a <= 12 && b > 12) { dia = b; mes = a; }
    return new Date(y, mes - 1, dia);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const fechaLarga = d => d ? `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}` : '';
const fechaISO = d => d ? d.toISOString().slice(0, 10) : '';

function idYouTube(url) {
  const s = String(url ?? '').trim();
  if (!s) return null;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}
const esShort = url => /youtube\.com\/shorts\//i.test(String(url ?? ''));

/* Convierte un enlace de Google Drive en enlace de descarga directa */
function enlaceDrive(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([A-Za-z0-9_-]{20,})/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/view`;
  return s;
}

/* ------------------------------------------------------------------ */
/*  Texto enriquecido → HTML                                           */
/* ------------------------------------------------------------------ */

function enLinea(t) {
  let s = esc(t);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, txt, url) => `<a href="${url}"${url.includes('dssolucionesacademicas.net') ? '' : ' target="_blank" rel="noopener"'}>${txt}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?)])/g, '$1<em>$2</em>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return s;
}

/* Devuelve { html, indice } donde indice son los H2 para la tabla de contenidos */
function cuerpoAHTML(texto) {
  const lineas = String(texto ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  const indice = [];
  let i = 0;

  const cerrar = (etiqueta) => { if (etiqueta) out.push(`</${etiqueta}>`); };
  let abierta = null;

  while (i < lineas.length) {
    const l = lineas[i];
    const t = l.trim();

    if (!t) { cerrar(abierta); abierta = null; i++; continue; }

    // Encabezados
    let m = t.match(/^(#{2,4})\s+(.*)$/);
    if (m) {
      cerrar(abierta); abierta = null;
      const nivel = m[1].length;
      const txt = m[2].trim();
      if (nivel === 2) {
        const id = slug(txt);
        indice.push({ id, txt });
        out.push(`<h2 id="${id}">${enLinea(txt)}</h2>`);
      } else {
        out.push(`<h${nivel}>${enLinea(txt)}</h${nivel}>`);
      }
      i++; continue;
    }

    // Bloque de aviso
    if (t.startsWith('>')) {
      cerrar(abierta); abierta = null;
      const bloque = [];
      while (i < lineas.length && lineas[i].trim().startsWith('>')) {
        bloque.push(lineas[i].trim().replace(/^>\s?/, '')); i++;
      }
      out.push(`<aside class="aviso">${enLinea(bloque.join(' '))}</aside>`);
      continue;
    }

    // Botón de descarga:  {{descarga:URL|Texto}}
    m = t.match(/^\{\{descarga:([^|}]+)\|?([^}]*)\}\}$/i);
    if (m) {
      cerrar(abierta); abierta = null;
      const url = enlaceDrive(m[1].trim());
      const txt = (m[2] || 'Descargar documento').trim();
      out.push(`<p class="descarga-linea"><a class="descarga" href="${esc(url)}" target="_blank" rel="noopener">${esc(txt)} <span aria-hidden="true">↓</span></a></p>`);
      i++; continue;
    }

    // Imagen
    m = t.match(/^!\[([^\]]*)\]\((\S+)\)$/);
    if (m) {
      cerrar(abierta); abierta = null;
      out.push(`<figure><img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy" decoding="async" width="1200" height="675">${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}</figure>`);
      i++; continue;
    }

    // Tabla
    if (t.startsWith('|') && t.endsWith('|')) {
      cerrar(abierta); abierta = null;
      const filas = [];
      while (i < lineas.length && lineas[i].trim().startsWith('|')) {
        filas.push(lineas[i].trim()); i++;
      }
      const celdas = f => f.slice(1, -1).split('|').map(c => c.trim());
      const separador = f => /^[\s|:-]+$/.test(f);
      let html = '<div class="tabla-envoltura"><table>';
      filas.forEach((f, n) => {
        if (separador(f)) return;
        const cs = celdas(f);
        const th = n === 0;
        html += '<tr>' + cs.map(c => th
          ? `<th>${enLinea(c)}</th>` : `<td>${enLinea(c)}</td>`).join('') + '</tr>';
        if (th) html += '';
      });
      html += '</table></div>';
      out.push(html);
      continue;
    }

    // Lista numerada
    if (/^\d+[.)]\s+/.test(t)) {
      if (abierta !== 'ol') { cerrar(abierta); out.push('<ol class="pasos">'); abierta = 'ol'; }
      out.push(`<li>${enLinea(t.replace(/^\d+[.)]\s+/, ''))}</li>`);
      i++; continue;
    }

    // Lista de puntos
    if (/^[-*]\s+/.test(t)) {
      if (abierta !== 'ul') { cerrar(abierta); out.push('<ul class="puntos">'); abierta = 'ul'; }
      out.push(`<li>${enLinea(t.replace(/^[-*]\s+/, ''))}</li>`);
      i++; continue;
    }

    // Párrafo (junta líneas seguidas)
    cerrar(abierta); abierta = null;
    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() &&
           !/^(#{2,4}\s|>|\||[-*]\s|\d+[.)]\s|!\[|\{\{)/.test(lineas[i].trim())) {
      parrafo.push(lineas[i].trim()); i++;
    }
    if (parrafo.length) out.push(`<p>${enLinea(parrafo.join(' '))}</p>`);
  }
  cerrar(abierta);

  return { html: out.join('\n'), indice };
}

function resumenPlano(texto, max = 165) {
  const p = String(texto ?? '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/^#{1,4}\s+.*$/gm, ' ')
    .replace(/[|>#*_`]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (p.length <= max) return p;
  const corte = p.slice(0, max);
  const esp = corte.lastIndexOf(' ');
  return (esp > max * 0.6 ? corte.slice(0, esp) : corte) + '…';
}

/* ------------------------------------------------------------------ */
/*  Lectura de la hoja                                                 */
/* ------------------------------------------------------------------ */

async function leerPestana(nombre) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.hoja}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(nombre)}&_=${Date.now()}`;
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`La pestaña "${nombre}" respondió ${r.status}`);
  const txt = await r.text();
  if (txt.trim().startsWith('<')) throw new Error(`La pestaña "${nombre}" no existe o la hoja no es pública`);
  return parseCSV(txt);
}

function mapear(encabezados, alias) {
  const n = encabezados.map(norm);
  const mapa = {};
  for (const campo of Object.keys(alias)) {
    const idx = n.findIndex(h => alias[campo].includes(h));
    if (idx !== -1) mapa[campo] = idx;
  }
  return mapa;
}

const publicado = v => {
  const e = norm(v);
  return !(e && ['no', 'borrador', 'oculto', '0', 'false', 'falso'].includes(e));
};

const ALIAS_BLOG = {
  titulo: ['titulo', 'title', 'nombre', 'encabezado', 'titular'],
  fecha: ['fecha', 'date', 'dia', 'publicacion'],
  contenido: ['contenido', 'texto', 'cuerpo', 'post', 'content', 'articulo'],
  video: ['video', 'youtube', 'enlace video', 'url video'],
  publicado: ['publicado', 'estado', 'activo', 'visible', 'mostrar'],
  categoria: ['categoria', 'tema', 'seccion', 'etiqueta', 'tipo', 'category'],
  resumen: ['resumen', 'extracto', 'descripcion', 'bajada', 'sumario']
};

const ALIAS_REC = {
  titulo: ['titulo', 'title', 'nombre', 'documento'],
  fecha: ['fecha', 'date', 'publicacion', 'actualizado'],
  descripcion: ['descripcion', 'detalle', 'resumen', 'contenido', 'texto'],
  categoria: ['categoria', 'tipo', 'seccion', 'clase'],
  nivel: ['nivel', 'subnivel', 'grado', 'curso'],
  asignatura: ['asignatura', 'materia', 'area', 'ambito'],
  anio: ['anio', 'ano', 'año', 'periodo', 'year', 'lectivo'],
  enlace: ['enlace', 'link', 'drive', 'url', 'archivo', 'descarga'],
  formato: ['formato', 'extension', 'tipo archivo'],
  publicado: ['publicado', 'estado', 'activo', 'visible', 'mostrar']
};

function construir(filas, alias, tipo) {
  if (!filas.length) return [];
  const mapa = mapear(filas[0], alias);
  if (mapa.titulo == null) throw new Error(`Falta la columna "titulo" en la pestaña de ${tipo}`);
  const items = [];
  const usados = new Set();

  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const g = k => (mapa[k] != null ? (f[mapa[k]] ?? '').trim() : '');
    const titulo = g('titulo');
    if (!titulo) continue;
    if (!publicado(g('publicado'))) continue;

    let s = slug(titulo) || `${tipo}-${i}`;
    let n = 2; while (usados.has(s)) s = `${slug(titulo)}-${n++}`;
    usados.add(s);

    const fecha = parseFecha(g('fecha'));
    const base = { titulo, slug: s, fecha, categoria: g('categoria') };

    if (tipo === 'blog') {
      const contenido = g('contenido');
      if (!contenido) continue;
      const v = g('video');
      items.push({
        ...base, contenido,
        video: idYouTube(v), vertical: esShort(v),
        resumen: g('resumen') || resumenPlano(contenido)
      });
    } else {
      items.push({
        ...base,
        descripcion: g('descripcion'),
        nivel: g('nivel'), asignatura: g('asignatura'), anio: g('anio'),
        enlace: enlaceDrive(g('enlace')),
        formato: (g('formato') || 'PDF').toUpperCase(),
        resumen: resumenPlano(g('descripcion'))
      });
    }
  }

  items.sort((a, b) => (a.fecha && b.fecha) ? b.fecha - a.fecha
    : a.fecha ? -1 : b.fecha ? 1 : a.titulo.localeCompare(b.titulo, 'es'));
  return items;
}

/* ------------------------------------------------------------------ */
/*  Plantilla                                                          */
/* ------------------------------------------------------------------ */

let CSS = '';

const NAV = [
  ['Servicios', '/#servicios'], ['Proceso', '/#proceso'],
  ['Instituciones', '/#instituciones'], ['Nuestra marca', '/#nosotros'],
  ['Preguntas', '/#preguntas'],
  ['Herramientas', '/herramientas/calculadora-muestra.html'],
  ['Blog', '/blog/'], ['Recursos', '/recursos/']
];

const WA = m => `https://wa.me/${CONFIG.telefono}?text=${encodeURIComponent(m)}`;

function pagina({ titulo, descripcion, url, cuerpo, jsonld = [], migas = [], ogTipo = 'website', extraCabeza = '' }) {
  const nav = NAV.map(([t, h]) =>
    `<a href="${h}"${url.startsWith(h) && h !== '/' ? ' aria-current="page"' : ''}>${t}</a>`).join('');

  const miguitas = migas.length
    ? `<div class="shell"><nav class="crumbs" aria-label="Ruta de navegación">${
        migas.map((m, i) => i === migas.length - 1
          ? `<span>${esc(m.t)}</span>`
          : `<a href="${m.h}">${esc(m.t)}</a> <span aria-hidden="true">/</span>`).join(' ')
      }</nav></div>` : '';

  const ld = jsonld.length
    ? `<script type="application/ld+json">\n${JSON.stringify(jsonld.length === 1 ? jsonld[0] : { '@context': 'https://schema.org', '@graph': jsonld }, null, 1)}\n</script>` : '';

  return `<!DOCTYPE html>
<html lang="es-EC">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>document.documentElement.classList.add('js')</script>
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<meta name="theme-color" content="#071f38">
<link rel="canonical" href="${CONFIG.base}${url}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="author" content="${CONFIG.autor}">
<meta name="geo.region" content="EC-L">
<meta name="geo.placename" content="Loja, Ecuador">
<meta property="og:type" content="${ogTipo}">
<meta property="og:locale" content="es_EC">
<meta property="og:site_name" content="DS Soluciones Academicas">
<meta property="og:url" content="${CONFIG.base}${url}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:image" content="${CONFIG.base}/img/og-ds.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(descripcion)}">
<meta name="twitter:image" content="${CONFIG.base}/img/og-ds.jpg">
<link rel="icon" href="/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preload" href="/fonts/Bricolage.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/PublicSans.woff2" as="font" type="font/woff2" crossorigin>
${extraCabeza}${ld}
<style>${CSS}</style>
</head>
<body>
  <a class="skip" href="#contenido">Saltar al contenido</a>
  <div class="progress" aria-hidden="true"><span id="progress"></span></div>
  <div class="utility"><div class="shell"><span>Loja · Atención digital en todo Ecuador</span><span>Alcance por escrito · Ajustes definidos · Atención directa</span></div></div>
  <header>
    <div class="shell nav">
      <a class="brand" href="/" aria-label="DS Soluciones Académicas, inicio"><img src="/img/logo-ds.png" alt="Logotipo de DS Soluciones Académicas" width="46" height="46"><span><strong>DS Soluciones</strong><small>Académicas</small></span></a>
      <nav class="links" id="navLinks" aria-label="Navegación principal">${nav}</nav>
      <a class="nav-cta" href="${WA('Hola Diego, vengo del sitio web de DS Soluciones Académicas y quiero cotizar un servicio.')}" target="_blank" rel="noopener">Cotizar <span>↗</span></a>
      <button class="menu" id="menu" type="button" aria-label="Abrir menú" aria-expanded="false"><i></i><i></i></button>
    </div>
  </header>
  ${miguitas}
  <main id="contenido">
${cuerpo}
  </main>
  <footer><div class="shell footer-grid"><div class="footer-intro"><a class="brand" href="/"><img loading="lazy" decoding="async" src="/img/logo-ds.png" alt="Logotipo de DS Soluciones Académicas" width="46" height="46"><span><strong style="color:#fff">DS Soluciones</strong><small>Académicas</small></span></a><p>Servicios académicos y documentales para estudiantes, docentes e instituciones.</p></div><div><h3>Servicios</h3><a href="/#servicios">Tesis y titulación</a><a href="/#servicios">Maestrías</a><a href="/#servicios">Pregrado y bachillerato</a><a href="/#instituciones">Docentes e instituciones</a></div><div><h3>Información</h3><a href="/#proceso">Cómo trabajamos</a><a href="/#nosotros">Nuestra identidad</a><a href="/#preguntas">Preguntas frecuentes</a><a href="/herramientas/calculadora-muestra.html">Calculadora de muestra</a><a href="/blog/">Blog</a><a href="/recursos/">Recursos docentes</a></div><div><h3>Atención</h3><p>Loja, Ecuador</p><p>Atención digital en todo Ecuador</p><a href="${WA('Hola Diego, vengo del sitio web y quiero cotizar un servicio.')}" target="_blank" rel="noopener">+593 98 907 4861</a></div></div><div class="shell footer-bottom"><span>© ${new Date().getFullYear()} DS Soluciones Académicas</span><span>Claridad · Confidencialidad · Responsabilidad</span></div></footer>
  <a class="wa" href="${WA('Hola Diego, vengo del sitio web y quiero cotizar un servicio.')}" target="_blank" rel="noopener"><span>WA</span><b>Cotizar</b></a>
<script>
(()=>{const m=document.querySelector('#menu'),n=document.querySelector('#navLinks');
m.addEventListener('click',()=>{const o=n.classList.toggle('open');m.setAttribute('aria-expanded',String(o));m.setAttribute('aria-label',o?'Cerrar menú':'Abrir menú')});
n.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{n.classList.remove('open');m.setAttribute('aria-expanded','false')}));
const p=document.querySelector('#progress'),s=()=>{const x=document.documentElement.scrollHeight-innerHeight;p.style.width=(x>0?scrollY/x*100:0)+'%'};
addEventListener('scroll',s,{passive:true});s();
const f=document.querySelectorAll('[data-filtro]'),t=document.querySelectorAll('[data-item]');
f.forEach(b=>b.addEventListener('click',()=>{const v=b.dataset.filtro;
 f.forEach(x=>x.classList.toggle('activo',x===b));
 t.forEach(x=>{x.hidden=!!v&&x.dataset.item!==v})}));
const q=document.querySelector('#buscador');
if(q)q.addEventListener('input',()=>{const v=q.value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
 t.forEach(x=>{x.hidden=v&&!x.dataset.buscar.includes(v)})});
})();
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Fichas de organización reutilizables                               */
/* ------------------------------------------------------------------ */

const PERSONA = {
  '@type': 'Person', '@id': `${CONFIG.base}/#diego`, name: CONFIG.autor,
  honorificPrefix: 'Lic.', jobTitle: 'Docente investigador y asesor metodologico',
  address: { '@type': 'PostalAddress', addressLocality: 'Loja', addressCountry: 'EC' }
};
const ORG = {
  '@type': 'ProfessionalService', '@id': `${CONFIG.base}/#organizacion`,
  name: 'DS Soluciones Academicas', url: `${CONFIG.base}/`,
  telephone: `+${CONFIG.telefono}`,
  address: { '@type': 'PostalAddress', addressLocality: 'Loja', addressRegion: 'Loja', addressCountry: 'EC' }
};
const migasLD = items => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((m, i) => ({
    '@type': 'ListItem', position: i + 1, name: m.t, item: CONFIG.base + m.h
  }))
});

/* ------------------------------------------------------------------ */
/*  CSS adicional para artículo largo y biblioteca                     */
/* ------------------------------------------------------------------ */

const CSS_EXTRA = `
/* --- Cabecera de sección --- */
.sec-hero{padding:66px 0 0}
.sec-hero h1{margin:0 0 20px;color:var(--navy);font:650 clamp(38px,5vw,66px)/1 Bricolage,sans-serif;letter-spacing:-.055em;max-width:17ch}
.sec-hero .lead{margin:0}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:32px}
.chips span,.chips button{padding:8px 14px;border:1px solid var(--line);background:#fff;color:var(--navy);font:700 9px PlexMono,monospace;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;transition:.18s}
.chips button:hover{border-color:var(--blue);color:var(--blue)}
.chips button.activo{background:var(--navy);border-color:var(--navy);color:#fff}
.sec-cuerpo{padding:56px 0 104px}
.buscador{width:100%;max-width:440px;margin:0 0 26px;padding:14px 16px;border:1px solid var(--line);background:#fff;font-family:inherit;font-size:15px;color:var(--ink)}
.buscador:focus{outline:2px solid var(--blue);outline-offset:-1px}

/* --- Rejilla de tarjetas --- */
.rejilla{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-left:1px solid var(--line)}
.tarjeta{position:relative;min-height:206px;display:flex;flex-direction:column;padding:25px;background:#fff;color:var(--ink);border-right:1px solid var(--line);border-bottom:1px solid var(--line);transition:.22s}
.tarjeta:hover{z-index:1;background:var(--blue);color:#fff;transform:translateY(-4px)}
.tarjeta a.cubre{position:absolute;inset:0;z-index:2}
.t-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px}
.t-cat{color:var(--cyan);font:700 8px PlexMono,monospace;letter-spacing:.14em;text-transform:uppercase;transition:.22s}
.tarjeta:hover .t-cat{color:var(--yellow)}
.t-fecha{color:var(--blue);font:700 8px PlexMono,monospace;letter-spacing:.12em;text-transform:uppercase;transition:.22s}
.tarjeta:hover .t-fecha,.tarjeta:hover .t-res{color:#fff}
.t-tit{margin:0 0 11px;font:700 22px/1.1 Bricolage,sans-serif;letter-spacing:-.02em}
.t-res{margin:0 0 18px;color:var(--muted);font-size:13px;line-height:1.7;transition:.22s}
.t-mas{margin-top:auto;display:flex;gap:18px;font-size:11px;font-weight:850;color:var(--blue);transition:.22s}
.tarjeta:hover .t-mas{color:#fff}
.t-thumb{position:relative;margin:-25px -25px 18px;aspect-ratio:16/9;background:var(--navy);overflow:hidden}
.t-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.t-play{position:absolute;inset:0;margin:auto;width:44px;height:44px;background:var(--yellow)}
.t-play:after{content:"";position:absolute;inset:0;margin:auto;width:0;height:0;border-left:13px solid var(--navy);border-top:8px solid transparent;border-bottom:8px solid transparent;transform:translateX(3px)}
.t-formato{position:absolute;top:0;right:0;padding:6px 10px;background:var(--navy);color:var(--yellow);font:700 8px PlexMono,monospace;letter-spacing:.12em}
.tarjeta:hover .t-formato{background:var(--yellow);color:var(--navy)}
.vacio{padding:60px 0;color:var(--muted);font:700 11px PlexMono,monospace;letter-spacing:.12em;text-transform:uppercase}

/* --- Artículo --- */
.art{padding:44px 0 104px}
.art-grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:64px;align-items:start}
.art-cabeza{max-width:760px;margin-bottom:40px}
.art-cat{display:inline-block;margin-bottom:14px;padding:6px 12px;border:1px solid var(--cyan);color:var(--cyan);font:700 9px PlexMono,monospace;letter-spacing:.16em;text-transform:uppercase}
.art h1{margin:0 0 20px;color:var(--navy);font:650 clamp(31px,4.2vw,52px)/1.04 Bricolage,sans-serif;letter-spacing:-.048em}
.art-datos{display:flex;flex-wrap:wrap;gap:8px 20px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font:700 9px PlexMono,monospace;letter-spacing:.13em;text-transform:uppercase}
.art-cuerpo{max-width:760px;font-size:17px;line-height:1.82;color:var(--ink)}
.art-cuerpo p{margin:0 0 1.3em}
.art-cuerpo h2{margin:2.2em 0 .7em;color:var(--navy);font:700 clamp(24px,2.7vw,32px)/1.15 Bricolage,sans-serif;letter-spacing:-.03em;scroll-margin-top:120px}
.art-cuerpo h3{margin:1.9em 0 .6em;color:var(--navy);font:700 20px/1.25 Bricolage,sans-serif;letter-spacing:-.02em}
.art-cuerpo h4{margin:1.6em 0 .5em;color:var(--navy);font:700 16px/1.3 Bricolage,sans-serif}
.art-cuerpo a{color:var(--blue);text-decoration:underline;text-underline-offset:3px}
.art-cuerpo strong{color:var(--navy)}
.art-cuerpo code{padding:2px 6px;background:#e8edf3;font:600 14px PlexMono,monospace}
.art-cuerpo ul.puntos,.art-cuerpo ol.pasos{margin:0 0 1.4em;padding:0;list-style:none;display:grid;gap:11px}
.art-cuerpo ul.puntos li{position:relative;padding-left:24px}
.art-cuerpo ul.puntos li:before{content:"";position:absolute;left:0;top:11px;width:9px;height:9px;background:var(--cyan)}
.art-cuerpo ol.pasos{counter-reset:paso}
.art-cuerpo ol.pasos li{position:relative;padding:2px 0 2px 46px;counter-increment:paso}
.art-cuerpo ol.pasos li:before{content:counter(paso,decimal-leading-zero);position:absolute;left:0;top:2px;width:31px;height:31px;display:grid;place-items:center;background:var(--navy);color:#fff;font:700 10px PlexMono,monospace}
.art-cuerpo .aviso{margin:1.8em 0;padding:22px 26px;background:var(--navy);color:#dae6f2;font-size:15.5px;line-height:1.7}
.art-cuerpo .aviso a{color:var(--yellow)}
.art-cuerpo .aviso strong{color:var(--yellow)}
.art-cuerpo figure{margin:1.9em 0}
.art-cuerpo figure img{width:100%;height:auto;display:block}
.art-cuerpo figcaption{margin-top:9px;color:var(--muted);font-size:13px}
.tabla-envoltura{margin:1.8em 0;overflow-x:auto;border:1px solid var(--line)}
.art-cuerpo table{width:100%;border-collapse:collapse;background:#fff;font-size:14.5px}
.art-cuerpo th{padding:13px 15px;background:var(--navy);color:#fff;text-align:left;font:700 9px PlexMono,monospace;letter-spacing:.13em;text-transform:uppercase;white-space:nowrap}
.art-cuerpo td{padding:12px 15px;border-top:1px solid var(--line);vertical-align:top}
.descarga-linea{margin:1.6em 0}
.descarga{display:inline-flex;align-items:center;gap:14px;padding:15px 24px;background:var(--yellow);color:var(--navy)!important;font:800 11px PlexMono,monospace;letter-spacing:.1em;text-transform:uppercase;text-decoration:none!important}
.descarga:hover{background:var(--navy);color:#fff!important}
.art-video{position:relative;aspect-ratio:16/9;margin:0 0 34px;background:var(--navy);overflow:hidden}
.art-video.vertical{aspect-ratio:9/16;max-width:370px}
.art-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}

/* --- Índice lateral --- */
.toc{position:sticky;top:104px;padding:22px 0 0;border-top:2px solid var(--navy)}
.toc b{display:block;margin-bottom:14px;color:var(--navy);font:700 9px PlexMono,monospace;letter-spacing:.16em;text-transform:uppercase}
.toc a{display:block;padding:7px 0;color:var(--muted);font-size:13.5px;line-height:1.45;border-bottom:1px solid var(--line)}
.toc a:hover{color:var(--blue)}

/* --- Ficha de documento --- */
.ficha{display:grid;grid-template-columns:1fr 320px;gap:56px;align-items:start;max-width:1100px}
.ficha-datos{background:#fff;border:1px solid var(--line);padding:28px}
.ficha-datos dl{margin:0;display:grid;gap:15px}
.ficha-datos dt{color:var(--muted);font:700 8px PlexMono,monospace;letter-spacing:.15em;text-transform:uppercase}
.ficha-datos dd{margin:3px 0 0;color:var(--navy);font-size:15px;font-weight:600}
.ficha-datos .descarga{margin-top:24px;width:100%;justify-content:center}
.nota-drive{margin:14px 0 0;color:var(--muted);font-size:12px;line-height:1.6}

/* --- Relacionados y cierre --- */
.relacionados{max-width:760px;margin-top:72px;padding-top:36px;border-top:1px solid var(--line)}
.relacionados b{display:block;margin-bottom:20px;color:var(--navy);font:700 9px PlexMono,monospace;letter-spacing:.16em;text-transform:uppercase}
.rel-lista{display:grid;gap:2px}
.rel-lista a{display:flex;justify-content:space-between;gap:20px;align-items:baseline;padding:15px 0;border-bottom:1px solid var(--line);color:var(--navy);font-size:16px;font-weight:600}
.rel-lista a:hover{color:var(--blue)}
.rel-lista small{color:var(--muted);font:700 8px PlexMono,monospace;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
.cierre-cta{max-width:760px;margin-top:56px;padding:30px 32px;background:var(--navy);color:#dae6f2}
.cierre-cta b{display:block;margin-bottom:9px;color:var(--yellow);font:700 9px PlexMono,monospace;letter-spacing:.16em;text-transform:uppercase}
.cierre-cta p{margin:0 0 18px;font-size:15.5px;line-height:1.7}
.cierre-cta a.boton{display:inline-flex;align-items:center;gap:14px;padding:14px 22px;background:var(--yellow);color:var(--navy);font:800 11px PlexMono,monospace;letter-spacing:.1em;text-transform:uppercase}
.cierre-cta a.boton:hover{background:#fff}

@media(max-width:1000px){
  .art-grid{grid-template-columns:1fr;gap:0}
  .toc{position:static;margin-bottom:38px}
  .ficha{grid-template-columns:1fr;gap:34px}
  .rejilla{grid-template-columns:1fr 1fr}
}
@media(max-width:650px){
  .sec-hero{padding:42px 0 0}
  .sec-cuerpo{padding:38px 0 74px}
  .art{padding:30px 0 74px}
  .rejilla{grid-template-columns:1fr}
  .tarjeta{min-height:0}
  .art-cuerpo{font-size:17px}
  .art-cuerpo ol.pasos li{padding-left:40px}
  .chips span,.chips button,.t-cat,.t-fecha{font-size:10px}
  .t-res{font-size:15px}
  .t-mas{font-size:14px}
}
`;

/* ------------------------------------------------------------------ */
/*  Generación de páginas                                              */
/* ------------------------------------------------------------------ */

const CTA_DOCENTE = ['¿Te toca preparar la documentación de tu institución?',
  'PEI, PCI, Código de Convivencia, MIEE, planificaciones e INEVAL, construidos con el diagnóstico y la información real de tu institución. Nunca plantillas genéricas.',
  'Consultar documento institucional'];

const CTA = {
  'curriculo': CTA_DOCENTE,
  'acuerdo ministerial': CTA_DOCENTE,
  'planificacion': CTA_DOCENTE,
  'documento institucional': CTA_DOCENTE,
  'instructivo': CTA_DOCENTE,
  'formato': CTA_DOCENTE,
  'guia docente': CTA_DOCENTE,
  'evaluacion': CTA_DOCENTE,
  'noticias educativas': ['¿Necesitas el documento adaptado a tu institución?', 'Elaboramos y actualizamos documentos técnicos con la información real de cada institución educativa.', 'Consultar documento institucional'],
  'docentes': ['¿Te toca preparar documentación institucional?', 'PEI, PCI, Código de Convivencia, MIEE, planificaciones e INEVAL, construidos con el diagnóstico de tu institución.', 'Consultar mi caso'],
  'instituciones': ['¿Te toca preparar documentación institucional?', 'PEI, PCI, Código de Convivencia, MIEE, planificaciones e INEVAL, construidos con el diagnóstico de tu institución.', 'Consultar mi caso'],
  'metodologia': ['¿Tu trabajo necesita más que un artículo?', 'Revisamos tu guía, tu avance y tu fecha antes de confirmar cualquier servicio. El alcance queda por escrito.', 'Preparar mi solicitud'],
  'estadistica': ['¿Necesitas resolver el análisis de tu tesis?', 'Análisis estadístico en SPSS, pruebas de hipótesis, interpretación y redacción de resultados según tu diseño.', 'Consultar análisis'],
  'normas apa': ['¿Necesitas dejar el documento listo para entregar?', 'Formato, citación y referencias según lo que exige tu institución, en APA 7 o Vancouver.', 'Consultar formato'],
  _: ['¿Tu caso necesita más que un artículo?', 'Revisamos tu guía, tu avance y tu fecha antes de confirmar cualquier servicio. El alcance queda definido por escrito.', 'Escribir por WhatsApp']
};

function bloqueCTA(categoria) {
  const [t, p, b] = CTA[norm(categoria)] || CTA._;
  return `<aside class="cierre-cta"><b>${esc(t)}</b><p>${esc(p)}</p>
<a class="boton" href="${WA(`Hola Diego, vengo del sitio web y quiero consultar sobre ${categoria || 'un trabajo académico'}.`)}" target="_blank" rel="noopener">${esc(b)} <span aria-hidden="true">↗</span></a></aside>`;
}

function relacionados(actual, todos, carpeta) {
  const mismos = todos.filter(x => x.slug !== actual.slug &&
    norm(x.categoria) === norm(actual.categoria)).slice(0, 4);
  const resto = todos.filter(x => x.slug !== actual.slug && !mismos.includes(x))
    .slice(0, Math.max(0, 4 - mismos.length));
  const lista = [...mismos, ...resto];
  if (!lista.length) return '';
  return `<section class="relacionados"><b>Sigue leyendo</b><div class="rel-lista">${
    lista.map(x => `<a href="/${carpeta}/${x.slug}.html"><span>${esc(x.titulo)}</span><small>${esc(x.categoria || '')}</small></a>`).join('')
  }</div></section>`;
}

function tarjetaBlog(p) {
  const mini = p.video ? `<div class="t-thumb"><img src="https://i.ytimg.com/vi/${p.video}/${p.vertical ? 'oardefault' : 'mqdefault'}.jpg" alt="" loading="lazy" decoding="async" width="480" height="270" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${p.video}/mqdefault.jpg'"><span class="t-play" aria-hidden="true"></span></div>` : '';
  return `<article class="tarjeta" data-item="${esc(p.categoria)}" data-buscar="${esc(norm(p.titulo + ' ' + p.resumen + ' ' + p.categoria))}">
${mini}<div class="t-meta">${p.categoria ? `<span class="t-cat">${esc(p.categoria)}</span>` : ''}${p.fecha ? `<time class="t-fecha" datetime="${fechaISO(p.fecha)}">${esc(fechaLarga(p.fecha))}</time>` : ''}</div>
<h2 class="t-tit">${esc(p.titulo)}</h2><p class="t-res">${esc(p.resumen)}</p>
<span class="t-mas">Leer publicación <span aria-hidden="true">→</span></span>
<a class="cubre" href="/blog/${p.slug}.html" aria-label="${esc(p.titulo)}"></a></article>`;
}

function tarjetaRecurso(r) {
  return `<article class="tarjeta" data-item="${esc(r.categoria)}" data-buscar="${esc(norm([r.titulo, r.resumen, r.categoria, r.nivel, r.asignatura, r.anio].join(' ')))}">
<span class="t-formato">${esc(r.formato)}</span>
<div class="t-meta">${r.categoria ? `<span class="t-cat">${esc(r.categoria)}</span>` : ''}${r.anio ? `<span class="t-fecha">${esc(r.anio)}</span>` : ''}</div>
<h2 class="t-tit">${esc(r.titulo)}</h2><p class="t-res">${esc(r.resumen)}</p>
<span class="t-mas">Ver documento <span aria-hidden="true">→</span></span>
<a class="cubre" href="/recursos/${r.slug}.html" aria-label="${esc(r.titulo)}"></a></article>`;
}

function indice({ carpeta, titulo, descripcion, h1, lead, chips, items, tarjeta, buscador, ldTipo, nombreLD }) {
  const cats = [...new Set(items.map(x => x.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const migas = [{ t: 'Inicio', h: '/' }, { t: chips, h: `/${carpeta}/` }];
  const filtros = cats.length > 1
    ? `<div class="chips"><button type="button" data-filtro="" class="activo">Todo</button>${cats.map(c => `<button type="button" data-filtro="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';

  const cuerpo = `<section class="sec-hero"><div class="shell">
<p class="eyebrow">${esc(chips)}</p>
<h1>${esc(h1)}</h1>
<p class="lead">${esc(lead)}</p>
${filtros}</div></section>
<section class="sec-cuerpo"><div class="shell">
${buscador ? `<input class="buscador" id="buscador" type="search" placeholder="Buscar por título, nivel o asignatura…" aria-label="Buscar">` : ''}
${items.length ? `<div class="rejilla">${items.map(tarjeta).join('')}</div>` : '<p class="vacio">Todavía no hay publicaciones.</p>'}
</div></section>`;

  return pagina({
    titulo, descripcion, url: `/${carpeta}/`, cuerpo, migas,
    jsonld: [
      { '@type': ldTipo, '@id': `${CONFIG.base}/${carpeta}/#seccion`, name: nombreLD,
        url: `${CONFIG.base}/${carpeta}/`, inLanguage: 'es-EC', description: descripcion,
        author: { '@id': `${CONFIG.base}/#diego` }, publisher: { '@id': `${CONFIG.base}/#organizacion` } },
      PERSONA, ORG, migasLD(migas)
    ]
  });
}

function paginaArticulo(p, todos) {
  const { html, indice: toc } = cuerpoAHTML(p.contenido);
  const migas = [{ t: 'Inicio', h: '/' }, { t: 'Blog', h: '/blog/' }, { t: p.titulo, h: `/blog/${p.slug}.html` }];
  const video = p.video
    ? `<div class="art-video${p.vertical ? ' vertical' : ''}"><iframe src="https://www.youtube.com/embed/${p.video}" title="${esc(p.titulo)}" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : '';

  const cuerpo = `<article class="art"><div class="shell">
<header class="art-cabeza">
${p.categoria ? `<span class="art-cat">${esc(p.categoria)}</span>` : ''}
<h1>${esc(p.titulo)}</h1>
<p class="lead">${esc(p.resumen)}</p>
<div class="art-datos">${p.fecha ? `<span>Publicado el <time datetime="${fechaISO(p.fecha)}">${esc(fechaLarga(p.fecha))}</time></span>` : ''}<span>Por ${esc(CONFIG.autor)}</span></div>
</header>
<div class="art-grid">
<div class="art-cuerpo">${video}${html}
${relacionados(p, todos, 'blog')}
${bloqueCTA(p.categoria)}
</div>
${toc.length > 2 ? `<nav class="toc" aria-label="Contenido del artículo"><b>En este artículo</b>${toc.map(x => `<a href="#${x.id}">${esc(x.txt)}</a>`).join('')}</nav>` : '<div></div>'}
</div></div></article>`;

  return pagina({
    titulo: `${p.titulo} | DS Soluciones Académicas`.slice(0, 65),
    descripcion: p.resumen.slice(0, 158), url: `/blog/${p.slug}.html`,
    cuerpo, migas, ogTipo: 'article',
    jsonld: [
      { '@type': 'BlogPosting', '@id': `${CONFIG.base}/blog/${p.slug}.html#articulo`,
        headline: p.titulo, description: p.resumen, inLanguage: 'es-EC',
        datePublished: fechaISO(p.fecha), dateModified: fechaISO(p.fecha),
        articleSection: p.categoria || undefined,
        mainEntityOfPage: `${CONFIG.base}/blog/${p.slug}.html`,
        image: `${CONFIG.base}/img/og-ds.jpg`,
        author: { '@id': `${CONFIG.base}/#diego` }, publisher: { '@id': `${CONFIG.base}/#organizacion` },
        isPartOf: { '@id': `${CONFIG.base}/blog/#seccion` } },
      PERSONA, ORG, migasLD(migas)
    ]
  });
}

function paginaRecurso(r, todos) {
  const { html } = cuerpoAHTML(r.descripcion);
  const migas = [{ t: 'Inicio', h: '/' }, { t: 'Recursos', h: '/recursos/' }, { t: r.titulo, h: `/recursos/${r.slug}.html` }];
  const dato = (t, v) => v ? `<dt>${t}</dt><dd>${esc(v)}</dd>` : '';

  const cuerpo = `<article class="art"><div class="shell">
<header class="art-cabeza">
${r.categoria ? `<span class="art-cat">${esc(r.categoria)}</span>` : ''}
<h1>${esc(r.titulo)}</h1>
<p class="lead">${esc(r.resumen)}</p>
</header>
<div class="ficha">
<div class="art-cuerpo">${html || `<p>${esc(r.resumen)}</p>`}
${bloqueCTA(r.categoria)}
</div>
<aside class="ficha-datos">
<dl>${dato('Categoría', r.categoria)}${dato('Nivel', r.nivel)}${dato('Asignatura', r.asignatura)}${dato('Año lectivo', r.anio)}${dato('Formato', r.formato)}${r.fecha ? `<dt>Actualizado</dt><dd>${esc(fechaLarga(r.fecha))}</dd>` : ''}</dl>
${r.enlace ? `<a class="descarga" href="${esc(r.enlace)}" target="_blank" rel="noopener">Abrir documento <span aria-hidden="true">↓</span></a>
<p class="nota-drive">El archivo se abre en Google Drive. Desde ahí puedes verlo o descargarlo.</p>` : '<p class="nota-drive">Documento en preparación.</p>'}
</aside>
</div>
${relacionados(r, todos, 'recursos')}
</div></article>`;

  return pagina({
    titulo: `${r.titulo} | Recursos DS`.slice(0, 65),
    descripcion: (r.resumen || r.titulo).slice(0, 158),
    url: `/recursos/${r.slug}.html`, cuerpo, migas,
    jsonld: [
      { '@type': 'DigitalDocument', '@id': `${CONFIG.base}/recursos/${r.slug}.html#doc`,
        name: r.titulo, description: r.resumen, inLanguage: 'es-EC',
        encodingFormat: r.formato, url: r.enlace || undefined,
        dateModified: fechaISO(r.fecha),
        educationalLevel: r.nivel || undefined, about: r.asignatura || undefined,
        author: { '@id': `${CONFIG.base}/#diego` }, publisher: { '@id': `${CONFIG.base}/#organizacion` } },
      PERSONA, ORG, migasLD(migas)
    ]
  });
}

/* ------------------------------------------------------------------ */
/*  Programa principal                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const t0 = Date.now();
  console.log('Generando el sitio de DS Soluciones Académicas\n');

  CSS = (await readFile('src/estilos.css', 'utf8')) + CSS_EXTRA;

  let filasBlog = [], filasRec = [];
  try { filasBlog = await leerPestana(CONFIG.pestanaBlog); }
  catch (e) { console.log('  aviso · pestaña Blog:', e.message); }
  try {
    filasRec = await leerPestana(CONFIG.pestanaRecursos);
    // Si la pestaña no existe, Google devuelve la primera de la hoja. Se
    // reconoce porque no trae ninguna columna propia de la biblioteca.
    const cab = (filasRec[0] || []).map(norm);
    const propias = ['enlace', 'link', 'drive', 'nivel', 'asignatura', 'archivo', 'descarga'];
    if (!cab.some(h => propias.includes(h))) {
      console.log('  aviso · no existe la pestaña "Recursos" en la hoja (se omite la sección)');
      filasRec = [];
    }
  } catch (e) { console.log('  aviso · pestaña Recursos:', e.message, '(se omite la sección)'); }

  const posts = filasBlog.length ? construir(filasBlog, ALIAS_BLOG, 'blog') : [];
  const recursos = filasRec.length ? construir(filasRec, ALIAS_REC, 'recursos') : [];
  console.log(`  ${posts.length} artículos · ${recursos.length} documentos\n`);

  for (const c of ['blog', 'recursos']) {
    const dir = path.join(CONFIG.salida, c);
    if (existsSync(dir)) await rm(dir, { recursive: true });
    await mkdir(dir, { recursive: true });
  }

  await writeFile(path.join(CONFIG.salida, 'blog', 'index.html'), indice({
    carpeta: 'blog', chips: 'Blog',
    titulo: 'Blog educativo: tesis, docencia y normativa | DS Soluciones',
    descripcion: 'Recursos para estudiantes y docentes de Ecuador: metodología de tesis, estadística, normas APA, gestión educativa y noticias del sistema educativo.',
    h1: 'Para quien estudia, enseña o investiga.',
    lead: 'Metodología y estadística para tu tesis. Recursos y normativa para tu aula. Y lo que va pasando en el sistema educativo ecuatoriano, contado sin adornos.',
    items: posts, tarjeta: tarjetaBlog, buscador: false,
    ldTipo: 'Blog', nombreLD: 'Blog de DS Soluciones Academicas'
  }));
  for (const p of posts) {
    await writeFile(path.join(CONFIG.salida, 'blog', `${p.slug}.html`), paginaArticulo(p, posts));
  }
  console.log(`  /blog/         ${posts.length + 1} páginas`);

  await writeFile(path.join(CONFIG.salida, 'recursos', 'index.html'), indice({
    carpeta: 'recursos', chips: 'Recursos docentes',
    titulo: 'Recursos para docentes: currículos y planificaciones | DS',
    descripcion: 'Biblioteca gratuita para docentes de Ecuador: currículos, acuerdos ministeriales, modelos de planificación y documentos institucionales, ordenados y listos.',
    h1: 'La documentación que necesitas, ordenada.',
    lead: 'Currículos, acuerdos ministeriales, modelos de planificación y documentos institucionales. Descarga libre, sin registro. Se actualiza cuando cambia la normativa.',
    items: recursos, tarjeta: tarjetaRecurso, buscador: true,
    ldTipo: 'CollectionPage', nombreLD: 'Recursos docentes de DS Soluciones Academicas'
  }));
  for (const r of recursos) {
    await writeFile(path.join(CONFIG.salida, 'recursos', `${r.slug}.html`), paginaRecurso(r, recursos));
  }
  console.log(`  /recursos/     ${recursos.length + 1} páginas`);

  const hoy = new Date().toISOString().slice(0, 10);
  const url = (loc, mod, freq, pri) =>
    `  <url>\n    <loc>${CONFIG.base}${loc}</loc>\n    <lastmod>${mod || hoy}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[
  url('/', hoy, 'monthly', '1.0'),
  url('/herramientas/calculadora-muestra', hoy, 'monthly', '0.9'),
  url('/blog/', hoy, 'daily', '0.9'),
  url('/recursos/', hoy, 'daily', '0.9'),
  ...posts.map(p => url(`/blog/${p.slug}.html`, fechaISO(p.fecha), 'monthly', '0.8')),
  ...recursos.map(r => url(`/recursos/${r.slug}.html`, fechaISO(r.fecha), 'monthly', '0.7'))
].join('\n')}
</urlset>`;
  await writeFile(path.join(CONFIG.salida, 'sitemap.xml'), sitemap);
  console.log(`  sitemap.xml    ${posts.length + recursos.length + 4} URLs`);

  console.log(`\nListo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
