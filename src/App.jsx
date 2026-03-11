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

      const prompt = `Eres Trazza Mix, el asistente agrónomo inteligente de Trazza360. Analizas agroquímicos de cualquier país del mundo con criterio técnico universal.

CULTIVO: ${cropData.cultivo || 'No especificado'}
PROBLEMA FITOSANITARIO: ${cropData.problema || 'No especificado'}
${cropData.cultivo || cropData.problema ? '→ Adapta las recomendaciones de dosis y compatibilidad al cultivo y problema indicados.' : '→ Sin cultivo/problema especificado, da recomendaciones generales.'}

PERFIL DEL USUARIO: ${tipoUsuario === 'ingeniero'
  ? 'INGENIERO AGRÓNOMO — usa terminología técnica completa: hidrólisis alcalina, CE, precipitación de sales, formulación WP/EC/SL, etc.'
  : 'AGRICULTOR — MUY breve y directo. 1 oración por campo. Sin tecnicismos. Frases simples: "Tu agua está bien", "Agrégalo primero", "Este producto mata hongos". Nada de palabras técnicas.'}

DATOS DEL AGUA:
${sinDatosAgua ? `SIN DATOS (campo opcional — el usuario no los ingresó):
- waterAlert = null. NO advertir ni regañar al usuario por no ingresar datos.
- Aplica WALE asumiendo agua neutra (pH 7, CE normal, dureza normal).
- BB5, Acidol, Triada-Aguas, Triple A y similares: sin datos de agua → van al FINAL (paso E) por precaución, asumiendo agua neutra. En el orden WALE explica: "Va al final porque sin datos del agua asumimos pH neutro, por lo que no se necesita como corrector al inicio."
- En el tip, menciona brevemente que ingresar datos de agua mejora la precisión del análisis.
- missingCorrector = false.` : `- pH: ${ph} → ${phVal > 7.5 ? '⚠️ ALCALINA — degrada activos, REQUIERE corrector de pH' : phVal < 4.0 ? '🚨 CRÍTICO — pH extremadamente ácido, NO APTO para mezclas agroquímicas, puede destruir activos y quemar cultivo' : phVal < 5.0 ? '⚠️ ÁCIDA — pH bajo (rango óptimo 5.5-7.0), puede afectar algunos activos' : phVal < 5.5 ? '⚠️ LIGERAMENTE ÁCIDA — pH aceptable pero en límite inferior, monitorear' : '✅ BUENA — rango seguro (5.5-7.0)'}
- CE: ${ce} mS/cm → ${ceVal > 3.0 ? '🚨 CRÍTICA — CE extremadamente alta, riesgo severo de precipitación y fitotoxicidad' : ceVal > 1.5 ? '⚠️ ALTA — riesgo de precipitación de sales' : '✅ OK'}
- Dureza: ${hardness} ppm → ${hardVal > 300 ? '🚨 MUY DURA — inactivación severa de activos, corrector obligatorio' : hardVal > 150 ? '⚠️ DURA — riesgo de inactivación, corrector necesario (umbral técnico: 150 ppm CaCO3)' : hardVal > 120 ? '⚠️ MODERADA — corrector recomendable (umbral conservador: 120 ppm CaCO3)' : '✅ BLANDA — sin riesgo de inactivación'}
${esAgua_critica ? '🚨 AGUA CRÍTICA: pH o CE fuera de rango peligroso. USA status "🔴 Agua No Apta para Mezcla". Activa waterAlert con advertencia URGENTE en MAYÚSCULAS. missingCorrector: true. missingCorrectorMsg debe decir que el agua debe tratarse ANTES de cualquier mezcla.' : esAgua_mala ? '🚨 AGUA PROBLEMÁTICA: Verifica si hay corrector/acidificante entre los productos. Si NO hay, activa missingCorrector: true.' : '✅ AGUA APTA: No se necesita corrector de pH. Los coadyuvantes/surfactantes NO son correctores de pH y van al FINAL.'}`}

═══ REGLAS WALE — ORDEN DE MEZCLA (INAMOVIBLES) ═══

PASO 0 — CORRECTOR DE pH/ABLANDADOR: 
  → SOLO si pH > 7.5 O dureza > 150 ppm Y hay un corrector alcalinizante entre los productos.
  → Si el agua está bien (pH 5.0-7.5 y dureza ≤ 150): NO va ningún corrector al inicio.
  → Si el agua YA es ácida (pH < 5.0): NO agregar más acidificantes. BB5, Triada-Aguas, Acidol van al FINAL.
  → BB5, Triada-Aguas, Triple A, Acidol-5, Surfaq: con agua ALCALINA (pH > 7.5) → paso 0 (INICIO). Con agua neutra o ácida → paso E (FINAL).
  → IMPORTANTE: pH entre 5.0-5.5 es PRECAUCIÓN LEVE — no es agua crítica, no exageres la alerta. Solo menciona que está en el límite inferior del rango óptimo.

PASO W — AGUA: Llenar el tanque con agua (no es un producto, no listar).

PASO A — AGENTES SÓLIDOS (WP, WG, SP): Polvos mojables y granulados dispersables. Siempre antes que líquidos.

PASO L — LÍQUIDOS (SL, EC, SC, SE, OD): Concentrados solubles, emulsionables y suspensiones. Después de los sólidos.

PASO E — EXTRAS/COADYUVANTES: Surfactantes, aceites, humectantes, adherentes. SIEMPRE AL FINAL sin excepción.

CLASIFICACIÓN OBLIGATORIA de cada producto:
- WP / PM (polvo mojable) → paso A
- WG / WDG (granulado dispersable) → paso A  
- SL (concentrado soluble) → paso L
- EC (concentrado emulsionable) → paso L
- SC / SE / OD (suspensión/emulsión) → paso L
- Coadyuvante / surfactante / aceite / adherente / humectante → paso E (FINAL)
- Corrector pH / acidificante / ablandador → paso 0 (SOLO si agua mala)

INSTRUCCIONES:
1. Identifica todos los productos de las imágenes y clasifica cada uno según su formulación.
2. DOSIS — REGLA ABSOLUTA E INAMOVIBLE:
   → SOLO acepta dosis que estén VISIBLEMENTE IMPRESAS en la etiqueta de la imagen que te envían.
   → Si puedes leer la dosis exacta en la imagen → úsala tal cual.
   → Si NO puedes leer la dosis con total certeza → OBLIGATORIO: dose: "Ver etiqueta ⚠️", doseConfirm: true. NO hay doseAdjusted, NO hay estimaciones, NO hay rangos inferidos.
   → PROHIBIDO ABSOLUTAMENTE: usar tu memoria o entrenamiento para completar dosis. Esto aplica a TODOS los productos sin excepción, incluyendo productos que conoces muy bien como BB5, Triggrr, Acidol, Quatro, Hieloxil, o cualquier otro. Si no lo lees claramente en la imagen = doseConfirm: true, sin excepción.
   → CASOS CONCRETOS PROHIBIDOS: BB5 no escribas rangos de dosis si no los ves. Triggrr no escribas rangos si no los ves. Acidol no escribas rangos si no los ves. Cualquier rango que venga de tu memoria = VIOLACION GRAVE.
   → PRUEBA MENTAL antes de escribir una dosis: ¿La veo escrita claramente en la imagen? Si la respuesta no es un SÍ rotundo → doseConfirm: true.
   → NO EXISTE doseAdjusted. NO ajustes dosis. NO asumas volúmenes. NO calcules. Solo lees o pones Ver etiqueta.
   → Si el usuario indicó cultivo, NO uses eso para calcular dosis — el cultivo solo sirve para el orden y el tip, nunca para inventar dosis.
3. Aplica WALE estrictamente según clasificación. Si el agua es buena, BB5 u otros coadyuvantes van al FINAL.
4. El TIP debe ser específico a ESTOS productos y ESTA agua. Nunca genérico.
5. DUREZA DEL AGUA vs PRODUCTOS: Si la dureza es > 120 ppm, identifica cuáles de los productos presentes son sensibles a la dureza (ej: glifosato, abamectina, cobre, mancozeb) y menciona explícitamente en el waterAlert o en el doseNote cuáles se ven afectados y cómo (pérdida de eficacia, precipitación, inactivación). No hagas mención genérica — nombra los productos afectados.
5. Adapta lenguaje al perfil del usuario arriba indicado.

Responde ÚNICAMENTE en JSON exacto, sin texto adicional, sin bloques de código:
{
  "status": "${statusForzado ? statusForzado : '🟢 Compatible / 🟡 Precaución / 🔴 Incompatible'}",  // IMPORTANTE: usa EXACTAMENTE este valor sin modificarlo
  "analysis": "Máximo 2 oraciones adaptadas al perfil.",
  "waterAlert": "1 oración sobre el agua, o null si está bien",
  "missingCorrector": false,
  "missingCorrectorMsg": "1 oración urgente si falta corrector, o null",
  "products": [
    {
      "name": "Nombre comercial",
      "active": "Ingrediente activo",
      "dose": "Dosis EXACTAMENTE como aparece en la etiqueta visible. Si no la ves claramente: Ver etiqueta ⚠️",
      "doseConfirm": false,
      "doseNote": null
    }
  ],
  "order": ["1. Nombre (dosis): razón en 1 oración"],
  "tip": "1 consejo específico del Ing. William para ESTA mezcla con ESTA agua"
}`;

      const parts = [
        { text: prompt },
        ...base64Images.map(img => ({ inlineData: img.inlineData }))
      ];

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
          }
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleanJson);
      if (statusForzado) parsed.status = statusForzado;
      if (esAgua_critica) parsed.missingCorrector = true;
      setResult(parsed);

      // Guardar en Firestore
      try {
        await addDoc(collection(db, 'analisis'), {
          timestamp: serverTimestamp(),
          perfil: tipoUsuario,
          agua: {
            ph: waterData.ph || null,
            ce: waterData.ce || null,
            dureza: waterData.hardness || null,
          },
          cultivo: cropData.cultivo || null,
          problema: cropData.problema || null,
          productos: parsed.products?.map(p => p.name) || [],
          formulaciones: parsed.products?.map(p => p.active) || [],
          cantidadProductos: base64Images.length,
          status: parsed.status || null,
          waterAlert: parsed.waterAlert || null,
          missingCorrector: parsed.missingCorrector || false,
          ordenMezcla: parsed.order || [],
          paisRegion: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
          idiomaBrowser: navigator.language || null,
        });
      } catch (fbError) {
        console.warn('Firebase error (no critico):', fbError);
      }

    } catch (error) {
      console.error("ERROR REAL:", error);
      alert("Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const shareWhatsApp = () => {
    if (!result) return;
    const productos = result.products?.map(p => `• ${p.name}${p.dose && !p.doseConfirm ? ' — ' + p.dose : ''}`).join('\n') || '';
    const orden = result.order?.map((s, i) => `${i+1}. ${s.replace(/✅\s*/,'')}`).join('\n') || '';
    const agua = waterData.ph || waterData.ce || waterData.hardness
      ? `pH: ${waterData.ph||'—'} | CE: ${waterData.ce||'—'} mS/cm | Dureza: ${waterData.hardness||'—'} ppm`
      : 'No ingresada';
    const msg = `🌱 *Simulación de mezcla — Trazza Mix*

*Estado:* ${result.status}

*Productos:*
${productos}

*Orden de mezcla (WALE):*
${orden}

*Calidad del agua:*
${agua}

*💡 Tip del Ing. William:*
${result.tip}

🔗 mix.trazza360.com
_Trazza Mix — Copiloto de Mezclas Agrícolas_
_Conoce más en: trazza360.com_`;
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