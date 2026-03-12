import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyBu3VxyXpWfP-Zh5ytbHVwzci7xtS2PW5w",
  authDomain: "trazza-mix.firebaseapp.com",
  projectId: "trazza-mix",
  storageBucket: "trazza-mix.firebasestorage.app",
  messagingSenderId: "30480365444",
  appId: "1:30480365444:web:2fd11ca071b9b2ae5e0fd1",
  measurementId: "G-H05D34W0RN"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
getAnalytics(firebaseApp);

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Pasos animados mientras espera respuesta
const LOADING_STEPS = [
  { msg: "📸 Leyendo etiquetas...", time: 0 },
  { msg: "🔬 Identificando activos...", time: 4000 },
  { msg: "💧 Evaluando calidad del agua...", time: 9000 },
  { msg: "⚗️ Calculando compatibilidad...", time: 14000 },
  { msg: "📋 Generando orden de mezcla...", time: 19000 },
  { msg: "✅ Casi listo...", time: 24000 },
];

function App() {
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState(null);
  const [images, setImages] = useState([]);
  const [base64Images, setBase64Images] = useState([]);
  const [waterData, setWaterData] = useState({ ph: '', ce: '', hardness: '' });
  const [cropData, setCropData] = useState({ cultivo: '', problema: '' });
  const [userType, setUserType] = useState('productor'); // 'productor' | 'ingeniero'
  const userTypeRef = useRef('productor');

  // Reanalizar automáticamente al cambiar perfil si ya hay resultado
  useEffect(() => {
    if (result && base64Images.length >= 2 && !loading) {
      analyzeMixWithType(userType);
    }
  }, [userType]);

  // Animar los pasos de carga
  useEffect(() => {
    if (!loading) { setLoadingStep(0); return; }
    const timers = LOADING_STEPS.map((step, i) =>
      setTimeout(() => setLoadingStep(i), step.time)
    );
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  const handleImages = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      setImages(prev => [...prev, url]);
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        setBase64Images(prev => [...prev, { inlineData: { data: base64, mimeType: file.type || "image/jpeg" } }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setBase64Images(prev => prev.filter((_, i) => i !== index));
  };

  const analyzeMix = () => analyzeMixWithType(userType);

  const analyzeMixWithType = async (tipoUsuario = userType) => {
    if (base64Images.length === 0) return alert("Por favor, sube al menos una etiqueta.");
    if (base64Images.length === 1) return alert("🌱 Agrega mínimo 2 productos para analizar la compatibilidad de la mezcla.");
    setLoading(true);
    setResult(null);

    try {
      const ph = waterData.ph;
      const ce = waterData.ce;
      const hardness = waterData.hardness;
      const sinDatosAgua = !ph && !ce && !hardness;
      const phVal = parseFloat(ph||0);
      const ceVal = parseFloat(ce||0);
      const hardVal = parseFloat(hardness||0);
      const esAgua_mala = !sinDatosAgua && (phVal > 7.5 || phVal < 5.0 || ceVal > 1.5 || hardVal > 150);
      const esAgua_critica = !sinDatosAgua && (phVal < 4.0 || phVal > 8.5 || ceVal > 3.0);
      const statusForzado = esAgua_critica ? '🔴 Agua No Apta para Mezcla' : null;

      // ═══════════════════════════════════════════════════
      // LLAMADA 1 — OCR PURO: solo extrae texto de imágenes
      // ═══════════════════════════════════════════════════
      const promptOCR = `Eres un escáner OCR especializado en etiquetas agroquímicas. Tu única función es extraer texto visible.

TAREA: Para cada etiqueta en las imágenes, extrae ÚNICAMENTE el texto que puedes leer visualmente.

Para cada producto retorna un objeto con estos campos — SOLO con lo que lees en la imagen:
- name: nombre comercial visible
- active: ingrediente(s) activo(s) visible(s). Si no lo ves claramente → "NO_LEGIBLE"
- formulation: tipo de formulación visible (WP, EC, SL, SC, etc). Si no la ves → "NO_LEGIBLE"  
- dose: dosis visible en la etiqueta. Si no la ves claramente → "NO_LEGIBLE"
- otherText: cualquier otro texto relevante visible (concentración, registro, fabricante)

REGLAS ABSOLUTAS:
→ Solo texto visible en la imagen. Cero inferencias. Cero memoria. Cero conocimiento previo.
→ Si un campo no es legible → "NO_LEGIBLE". Nunca dejes un campo vacío con datos inventados.
→ No sabes qué producto es. No tienes contexto. Solo lees píxeles.

Responde ÚNICAMENTE en JSON:
{"productos": [{"name":"...","active":"...","formulation":"...","dose":"...","otherText":"..."}]}`;

      const ocrResponse = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptOCR }, ...base64Images.map(img => ({ inlineData: img.inlineData }))] }],
          generationConfig: { temperature: 0, maxOutputTokens: 2048 }
        })
      });

      if (!ocrResponse.ok) throw new Error(`OCR HTTP ${ocrResponse.status}`);
      const ocrData = await ocrResponse.json();
      const ocrText = ocrData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const ocrClean = ocrText.replace(/```json|```/g, '').trim();
      const ocrParsed = JSON.parse(ocrClean);
      const productosLeidos = ocrParsed.productos || [];

      // ═══════════════════════════════════════════════════
      // LLAMADA 2 — RAZONAMIENTO WALE: sin imágenes, solo datos OCR
      // ═══════════════════════════════════════════════════
      // ═══════════════════════════════════════════════════════════════
      // CAPA JS: Validaciones duras que Gemini NO decide
      // ═══════════════════════════════════════════════════════════════
      const detectarDuplicados = (productos) => {
        const dupes = [];
        for (let i = 0; i < productos.length; i++) {
          for (let j = i + 1; j < productos.length; j++) {
            const a1 = (productos[i].active || '').trim().toUpperCase();
            const a2 = (productos[j].active || '').trim().toUpperCase();
            const legible = (a) => a && a !== 'NO_LEGIBLE' && !a.includes('VER ETIQUETA');
            if (legible(a1) && legible(a2) && a1 === a2) {
              dupes.push(`${productos[i].name} y ${productos[j].name} tienen el mismo activo: ${productos[i].active}`);
            }
          }
        }
        return dupes;
      };

      // ═══════════════════════════════════════════════════════════════
      // LLAMADA 2 — GEMINI RAZONA: recibe texto OCR, sin imágenes
      // Sin imágenes = sin reconocimiento de marca = sin alucinaciones
      // Gemini hace el razonamiento agronómico completo con datos limpios
      // ═══════════════════════════════════════════════════════════════
      const promptRazonamiento = `Eres Trazza Mix, el motor agronómico de Trazza360.
Recibes texto extraído por OCR de etiquetas físicas. NO tienes imágenes. NO tienes contexto visual.
Solo existen los datos de texto que te entrego abajo. Nada más.

DATOS EXTRAÍDOS POR OCR (lo que literalmente dice cada etiqueta):
${JSON.stringify(productosLeidos, null, 2)}

REGLA ABSOLUTA DE DATOS:
→ Cualquier campo que diga "NO_LEGIBLE" = ese dato no existe. No lo completes, no lo inferes, no lo recuerdas.
→ Si active = "NO_LEGIBLE" → en tu respuesta pon active: "Ver etiqueta ⚠️"
→ Si dose = "NO_LEGIBLE" → en tu respuesta pon dose: "Ver etiqueta ⚠️", doseConfirm: true
→ NUNCA uses tu conocimiento de entrenamiento para completar campos NO_LEGIBLE. Si no está en los datos OCR, no existe.

CULTIVO: ${cropData.cultivo || 'No especificado'}
PROBLEMA: ${cropData.problema || 'No especificado'}

PERFIL: ${tipoUsuario === 'ingeniero'
  ? 'INGENIERO AGRÓNOMO — terminología técnica: hidrólisis alcalina, CE, precipitación de sales, WP/EC/SL.'
  : 'AGRICULTOR — muy breve, sin tecnicismos. "Tu agua está bien", "Agrégalo primero". Máximo 1 oración por campo.'}

DATOS DEL AGUA:
${sinDatosAgua
  ? `Sin datos de agua ingresados. Asume agua neutra. Acidificantes/correctores van al FINAL por precaución.`
  : `pH: ${ph} (${phVal > 8.5 ? '🚨 CRÍTICO — extremadamente alcalino' : phVal > 7.5 ? '⚠️ ALCALINO — requiere corrector' : phVal < 4.0 ? '🚨 CRÍTICO — extremadamente ácido' : phVal < 5.0 ? '⚠️ ÁCIDO — puede dañar activos' : phVal < 5.5 ? '⚠️ LÍMITE inferior del rango óptimo' : '✅ ÓPTIMO 5.5-7.5'})
CE: ${ce} mS/cm (${ceVal > 3.0 ? '🚨 CRÍTICA — riesgo severo precipitación' : ceVal > 1.5 ? '⚠️ ALTA — riesgo precipitación de sales' : '✅ OK'})
Dureza: ${hardness} ppm (${hardVal > 300 ? '🚨 MUY DURA — inactivación severa' : hardVal > 150 ? '⚠️ DURA — corrector necesario' : hardVal > 120 ? '⚠️ MODERADA — corrector recomendable' : '✅ BLANDA'})
${esAgua_critica ? '→ AGUA CRÍTICA: status debe ser "🔴 Agua No Apta para Mezcla". waterAlert en MAYÚSCULAS urgente.' : aguaMalaMotor ? '→ AGUA PROBLEMÁTICA: si no hay corrector entre los productos → missingCorrector: true.' : '→ AGUA APTA: coadyuvantes y surfactantes NO son correctores, van al FINAL.'}`}

═══ ALGORITMO WALE — ORDEN OBLIGATORIO ═══

Clasifica cada producto por su formulación (léela del campo formulation del OCR) y ordénalo:
PASO 0: Correctores de pH / ablandadores → SOLO si agua alcalina (pH>7.5) o muy dura (>150ppm). Si agua normal o sin datos → van al FINAL.
PASO A: WP, WG, SP (sólidos) → siempre antes que líquidos
PASO L: SL, EC, SC, SE, OD (líquidos) → después de sólidos  
PASO E: Coadyuvantes, surfactantes, aceites, adherentes → SIEMPRE al final sin excepción

COMPATIBILIDAD — razona con los activos que puedas leer:
→ Mismo activo en 2 productos (ambos legibles) = 🔴 sobredosis
→ Incompatibilidades conocidas (cobre+aceite, azufre+aceite en calor, etc.) = 🟡 Precaución
→ Si algún activo es NO_LEGIBLE = no puedes afirmar incompatibilidad por activos, indica precaución

DUREZA Y ACTIVOS SENSIBLES: Si dureza > 120ppm, menciona explícitamente qué activos legibles se ven afectados (glifosato, abamectina, cobre, mancozeb son sensibles). Nómbralos, no hagas mención genérica.

Responde ÚNICAMENTE en JSON exacto, sin texto adicional:
{
  "status": "${statusForzado || '🟢 Compatible / 🟡 Precaución / 🔴 Incompatible — elige el correcto'}",
  "analysis": "1-2 oraciones adaptadas al perfil del usuario",
  "waterAlert": "1 oración sobre el agua o null",
  "missingCorrector": false,
  "missingCorrectorMsg": "1 oración urgente o null",
  "products": [
    {
      "name": "nombre del OCR",
      "active": "activo del OCR — si NO_LEGIBLE: Ver etiqueta ⚠️",
      "dose": "dosis del OCR — si NO_LEGIBLE: Ver etiqueta ⚠️",
      "doseConfirm": false,
      "doseNote": null
    }
  ],
  "order": ["1. Nombre (dosis): razón WALE en 1 oración"],
  "tip": "1 consejo práctico específico del Ing. William para ESTA mezcla y ESTA agua"
}`;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptRazonamiento }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 4096 }
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      // GARANTÍAS FINALES EN CÓDIGO — incondicionales
      // 1. Duplicados detectados matemáticamente → siempre rojo
      const duplicados = detectarDuplicados(parsed.products || []);
      if (duplicados.length > 0) {
        parsed.status = '🔴 Ingredientes duplicados — riesgo de sobredosis';
        parsed.analysis = `⚠️ ${duplicados.join('. ')}. Usar ambos es sobredosis — elige uno solo. ` + (parsed.analysis || '');
      }
      // 2. Agua crítica → siempre rojo sin importar lo que diga Gemini
      if (statusForzado) parsed.status = statusForzado;
      // 3. Productos con doseConfirm → garantizar que no muestren dosis inventada
      if (parsed.products) {
        parsed.products = parsed.products.map((p, i) => {
          const ocrP = productosLeidos[i] || {};
          const doseNoLegible = !ocrP.dose || ocrP.dose === 'NO_LEGIBLE';
          const activeNoLegible = !ocrP.active || ocrP.active === 'NO_LEGIBLE';
          return {
            ...p,
            dose: doseNoLegible ? 'Ver etiqueta ⚠️' : p.dose,
            doseConfirm: doseNoLegible,
            active: activeNoLegible ? 'Ver etiqueta ⚠️' : p.active,
          };
        });
      }

      setResult(parsed);

      // Guardar en Firestore
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await addDoc(collection(db, 'analisis'), {
          timestamp: serverTimestamp(),
          perfil: tipoUsuario,
          agua: { ph: ph||null, ce: ce||null, dureza: hardness||null },
          cultivo: cropData.cultivo||null,
          problema: cropData.problema||null,
          productos: (parsed.products||[]).map(p => p.name),
          formulaciones: (parsed.products||[]).map(p => p.active),
          cantidadProductos: (parsed.products||[]).length,
          status: parsed.status,
          waterAlert: parsed.waterAlert||null,
          missingCorrector: parsed.missingCorrector||false,
          ordenMezcla: parsed.order||[],
          duplicados: duplicados.length > 0 ? duplicados : null,
          paisRegion: timezone,
          idiomaBrowser: navigator.language,
        });
      } catch (fbErr) { console.warn('Firestore error:', fbErr); }

    } catch (err) {
      console.error('Error:', err);
      alert('Error al analizar. Verifica tu conexión e intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const shareWhatsApp = () => {
    if (!result) return;
    const productos = result.products?.map(p => `• ${p.name}: ${p.doseConfirm ? 'Ver etiqueta ⚠️' : p.dose}`).join('\n') || '';
    const orden = result.order?.map((s, i) => `${i+1}. ${s.replace(/^\d+\.\s*/, '')}`).join('\n') || '';
    const msg = `🌱 *Análisis de mezcla — Trazza Mix*\n\n*Status:* ${result.status}\n\n*Productos:*\n${productos}\n\n*Orden WALE:*\n${orden}\n\n💡 *Tip:* ${result.tip}\n\n🔗 mix.trazza360.com\n_Trazza Mix — Copiloto de Mezclas Agrícolas_\n_Conoce más en: trazza360.com_`;
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };


  const resetApp = () => {
    setImages([]);
    setBase64Images([]);
    setResult(null);
    setWaterData({ ph: '', ce: '', hardness: '' });
    setCropData({ cultivo: '', problema: '' });
  };

  const getBorderColor = (status) => {
    if (!status) return '#22c55e';
    if (status.includes('🔴') || status.toLowerCase().includes('incompatible')) return '#ef4444';
    if (status.includes('🟡') || status.toLowerCase().includes('precaución')) return '#facc15';
    return '#22c55e';
  };

  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="container">

      {/* HEADER compacto */}
      <header style={{ textAlign: 'center', paddingTop: '28px', paddingBottom: '8px' }}>
        <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: '800', color: '#15803d', letterSpacing: '-0.5px' }}>
          Trazza Mix
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '0.92rem', color: '#94a3b8', fontStyle: 'italic' }}>
          Copiloto Global de Mezclas Agrícolas
        </p>
      </header>

      {/* Selector de perfil — chips pequeños */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', margin: '16px 0' }}>
        {['productor', 'ingeniero'].map(tipo => (
          <button key={tipo} onClick={() => { userTypeRef.current = tipo; setUserType(tipo); }} style={{
            padding: '6px 18px', borderRadius: '20px', border: '1.5px solid',
            borderColor: userType === tipo ? '#16a34a' : '#e2e8f0',
            background: userType === tipo ? '#16a34a' : 'white',
            color: userType === tipo ? 'white' : '#64748b',
            fontWeight: userType === tipo ? '700' : '400',
            fontSize: '0.82rem', cursor: 'pointer', transition: 'all 0.2s'
          }}>
            {tipo === 'productor' ? '🌾 Productor' : '👨‍🔬 Ingeniero'}
          </button>
        ))}
      </div>

      {/* ZONA HÉROE — la cámara protagonista */}
      <div style={{
        background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
        borderRadius: '20px', padding: '24px 20px', marginBottom: '16px',
        border: '2px dashed #86efac', textAlign: 'center'
      }}>
        <input type="file" accept="image/*" capture="environment" multiple id="camera-input" hidden onChange={handleImages} />
        <input type="file" accept="image/*" multiple id="gallery-input" hidden onChange={handleImages} />

        {images.length === 0 ? (
          <>
            <div style={{ fontSize: '3.5rem', marginBottom: '8px', lineHeight: 1 }}>📸</div>
            <p style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: '700', color: '#15803d' }}>
              Fotografía las etiquetas
            </p>
            <p style={{ margin: '0 0 20px', fontSize: '0.8rem', color: '#64748b' }}>
              Mínimo 2 productos · Solo etiquetas agroquímicas
            </p>
          </>
        ) : (
          <div className="preview-grid" style={{ marginBottom: '16px', justifyContent: 'center' }}>
            {images.map((img, i) => (
              <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                <img src={img} className="mini-img" alt="etiqueta" />
                <button onClick={() => removeImage(i)} style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  background: '#ef4444', color: 'white', border: 'none',
                  borderRadius: '50%', width: '20px', height: '20px',
                  fontSize: '0.7rem', cursor: 'pointer', lineHeight: '1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 'bold', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {'ontouchstart' in window ? (
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <label htmlFor="camera-input" style={{
              flex: 1, maxWidth: '160px', padding: '13px', background: '#16a34a', color: 'white',
              borderRadius: '12px', textAlign: 'center', cursor: 'pointer',
              fontSize: '0.95rem', fontWeight: '700', boxShadow: '0 4px 12px rgba(22,163,74,0.3)'
            }}>📷 Cámara</label>
            <label htmlFor="gallery-input" style={{
              flex: 1, maxWidth: '160px', padding: '13px', background: 'white', color: '#475569',
              borderRadius: '12px', textAlign: 'center', cursor: 'pointer',
              fontSize: '0.95rem', fontWeight: '600', border: '1.5px solid #cbd5e1'
            }}>🖼️ Galería</label>
          </div>
        ) : (
          <label htmlFor="gallery-input" style={{
            display: 'inline-block', padding: '13px 32px',
            background: '#16a34a', color: 'white', borderRadius: '12px',
            cursor: 'pointer', fontSize: '0.95rem', fontWeight: '700',
            boxShadow: '0 4px 12px rgba(22,163,74,0.3)'
          }}>
            📁 Agregar etiquetas
          </label>
        )}

        {images.length > 0 && (
          <p style={{ margin: '12px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
            {images.length} etiqueta(s) · toca para agregar más
          </p>
        )}
      </div>

      {/* Opciones avanzadas — colapsadas */}
      <div style={{ marginBottom: '16px' }}>
        <button onClick={() => setShowAdvanced(v => !v)} style={{
          width: '100%', padding: '10px 16px', background: 'white',
          border: '1px solid #e2e8f0', borderRadius: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', fontSize: '0.85rem', color: '#475569', fontWeight: '500'
        }}>
          <span>💧 ¿Conoces el pH de tu agua o tu cultivo?</span>
          <span style={{ transition: 'transform 0.2s', transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
        </button>

        {showAdvanced && (
          <div style={{
            background: 'white', border: '1px solid #e2e8f0', borderTop: 'none',
            borderRadius: '0 0 12px 12px', padding: '16px'
          }}>
            {/* Agua */}
            <p style={{ margin: '0 0 10px', fontSize: '0.8rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              💧 Calidad del Agua
            </p>
            <div className="water-grid" style={{ marginBottom: '16px' }}>
              <div className="input-group">
                <label>pH</label>
                <input type="number" step="0.1" value={waterData.ph} onChange={(e) => setWaterData({...waterData, ph: e.target.value})} />
              </div>
              <div className="input-group">
                <label>CE (mS/cm)</label>
                <input type="number" step="0.1" value={waterData.ce} onChange={(e) => setWaterData({...waterData, ce: e.target.value})} />
              </div>
              <div className="input-group">
                <label>Dureza (ppm)</label>
                <input type="number" value={waterData.hardness} onChange={(e) => setWaterData({...waterData, hardness: e.target.value})} />
              </div>
            </div>

            {/* Cultivo y problema */}
            <p style={{ margin: '0 0 10px', fontSize: '0.8rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              🌱 Cultivo y Problema
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className="input-group" style={{ flex: 1 }}>
                <label>Cultivo</label>
                <input type="text" placeholder="vid, tomate, maíz" value={cropData.cultivo}
                  onChange={e => setCropData({...cropData, cultivo: e.target.value})} />
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label>Problema</label>
                <input type="text" placeholder="mildiu, trips..." value={cropData.problema}
                  onChange={e => setCropData({...cropData, problema: e.target.value})} />
              </div>
            </div>
          </div>
        )}
      </div>



      {/* Botón con estado animado */}
      <button id="btn-analyze" className="btn-analyze" onClick={analyzeMix} disabled={loading}>
        {loading ? LOADING_STEPS[loadingStep].msg : `Analizar Mezcla (${images.length})`}
      </button>

      {/* Barra de progreso */}
      {loading && (
        <div style={{ marginTop: '10px', background: '#e2e8f0', borderRadius: '10px', height: '6px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', background: '#16a34a', borderRadius: '10px',
            width: `${((loadingStep + 1) / LOADING_STEPS.length) * 100}%`,
            transition: 'width 1s ease'
          }} />
        </div>
      )}

      {result && (
        <div className="result-card" style={{ borderTop: `6px solid ${getBorderColor(result.status)}` }}>
          {/* Índice de riesgo visual */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <h2 style={{ margin: 0 }}>{result.status}</h2>
            <div style={{
              fontSize: '0.75rem', fontWeight: 'bold', padding: '3px 10px',
              borderRadius: '20px', background: getBorderColor(result.status) + '22',
              color: getBorderColor(result.status), border: `1px solid ${getBorderColor(result.status)}`
            }}>
              {result.status?.includes('🟢') ? 'RIESGO BAJO' :
               result.status?.includes('🟡') ? 'RIESGO MEDIO' : 'RIESGO ALTO'}
            </div>
          </div>

          {/* 🚨 Alerta crítica: falta corrector de pH */}
          {result.missingCorrector && result.missingCorrectorMsg && (
            <div style={{
              background: '#fef2f2', border: '2px solid #ef4444',
              borderRadius: '10px', padding: '12px 14px', marginBottom: '12px'
            }}>
              🚨 <strong>¡ATENCIÓN!</strong> {result.missingCorrectorMsg}
            </div>
          )}

          {/* Alerta de agua */}
          {result.waterAlert && (
            <div style={{
              background: '#fef3c7', border: '1px solid #f59e0b',
              borderRadius: '10px', padding: '10px 14px', marginBottom: '12px', fontSize: '0.9rem'
            }}>
              💧 <strong>Alerta de Agua:</strong> {result.waterAlert}
            </div>
          )}

          <p><strong>Análisis:</strong> {result.analysis}</p>

          {/* Productos y dosis */}
          {result.products && result.products.length > 0 && (
            <div className="order-list" style={{ marginBottom: '12px' }}>
              <p><strong>PRODUCTOS Y DOSIS:</strong></p>
              {result.products.map((p, i) => (
                <div key={i} style={{
                  background: '#f8fafc', borderRadius: '10px',
                  padding: '10px 12px', marginBottom: '8px', borderLeft: '4px solid #16a34a'
                }}>
                  <p style={{ margin: '0 0 4px', fontWeight: 'bold' }}>🧪 {p.name}</p>
                  <p style={{ margin: '0 0 2px', fontSize: '0.85rem', color: '#475569' }}>Activo: {p.active}</p>
                  {p.doseConfirm ? (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '8px 10px', margin: '4px 0' }}>
                      <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontWeight: 'bold', color: '#b45309' }}>
                        ⚠️ Dosis: confirmar con etiqueta física
                      </p>
                      <p style={{ margin: '0', fontSize: '0.8rem', color: '#92400e' }}>
                        No se pudo leer con claridad — verifica antes de aplicar
                      </p>
                    </div>
                  ) : (
                    <p style={{ margin: '0 0 2px', fontSize: '0.85rem' }}>Dosis: <strong>{p.dose}</strong></p>
                  )}

                  {p.doseNote && !p.doseConfirm && (
                    <p style={{ margin: '0', fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>{p.doseNote}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Orden WALE — diseño premium */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '4px', height: '20px', background: '#16a34a', borderRadius: '2px' }}/>
              <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.9rem', color: '#1e293b', letterSpacing: '0.05em' }}>
                ORDEN DE MEZCLA (WALE)
              </p>
            </div>
            {result.order.map((s, i) => {
              const stepColors = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4'];
              const color = stepColors[i % stepColors.length];
              const cleanText = s.replace(/^\d+\.\s*/, '');
              const colonIdx = cleanText.indexOf(':');
              const title = colonIdx > -1 ? cleanText.substring(0, colonIdx) : cleanText;
              const desc = colonIdx > -1 ? cleanText.substring(colonIdx + 1).trim() : '';
              return (
                <div key={i} style={{
                  display: 'flex', gap: '12px', alignItems: 'flex-start',
                  background: 'white', borderRadius: '12px', padding: '12px 14px',
                  marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
                  border: '1px solid #f1f5f9'
                }}>
                  <div style={{
                    minWidth: '28px', height: '28px', borderRadius: '50%',
                    background: color, color: 'white', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8rem', fontWeight: 'bold', flexShrink: 0
                  }}>{i + 1}</div>
                  <div>
                    <p style={{ margin: '0 0 2px', fontWeight: 'bold', fontSize: '0.88rem', color: '#1e293b' }}>{title}</p>
                    {desc && <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>{desc}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="william-tip"><i><strong>Tip del Ing. William:</strong> {result.tip}</i></p>

          {/* Botones de acción */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <button onClick={resetApp} style={{
              flex: 1, padding: '14px', background: '#ef4444', color: 'white',
              border: 'none', borderRadius: '12px', fontSize: '0.95rem',
              fontWeight: 'bold', cursor: 'pointer'
            }}>🔄 Nueva Mezcla</button>
            <button onClick={shareWhatsApp} style={{
              flex: 1, padding: '14px', background: '#25D366', color: 'white',
              border: 'none', borderRadius: '12px', fontSize: '0.95rem',
              fontWeight: 'bold', cursor: 'pointer'
            }}>📲 Compartir</button>
          </div>
        </div>
      )}

      {/* Footer Powered by Trazza360 */}
      <div style={{ textAlign: 'center', marginTop: '24px', paddingBottom: '16px' }}>
        <a href="https://trazza360.com" target="_blank" rel="noopener noreferrer"
          style={{ color: '#94a3b8', fontSize: '0.78rem', textDecoration: 'none' }}
          onMouseEnter={e => e.currentTarget.querySelector('strong').style.textDecoration = 'underline'}
          onMouseLeave={e => e.currentTarget.querySelector('strong').style.textDecoration = 'none'}>
          Trazza Mix · Herramienta del ecosistema <strong style={{ color: '#16a34a', textDecoration: 'none', transition: 'all 0.2s' }}>Trazza360 ↗</strong>
        </a>
      </div>
    </div>
  );
}

export default App;