export type Lang = "en" | "it";

const translations = {
  // ── Language picker ──
  "lang.title": {
    en: "Choose your language",
    it: "Scegli la tua lingua",
  },
  "lang.en": { en: "English", it: "Inglese" },
  "lang.it": { en: "Italiano", it: "Italiano" },

  // ── Header ──
  "header.title": { en: "Render Studio", it: "Render Studio" },

  // ── Upload / Project setup ──
  "upload.hero": {
    en: "Turn your drawings into",
    it: "Trasforma i tuoi disegni in",
  },
  "upload.heroHighlight": {
    en: "photorealistic renders",
    it: "render fotorealistici",
  },
  "upload.subtitle": {
    en: "Set up your project, upload reference images for inspiration, and we'll generate three render variants automatically.",
    it: "Configura il tuo progetto, carica immagini di riferimento per ispirazione, e genereremo tre varianti di render automaticamente.",
  },
  "upload.projectSetup": { en: "Project setup", it: "Configurazione progetto" },
  "upload.projectSetupSub": {
    en: "Name your project and upload the SketchUp screenshot.",
    it: "Dai un nome al tuo progetto e carica lo screenshot di SketchUp.",
  },
  "upload.projectName": { en: "Project name", it: "Nome progetto" },
  "upload.projectNamePlaceholder": {
    en: "e.g. Candidasa Villa",
    it: "es. Villa Candidasa",
  },
  "upload.screenshot": { en: "SketchUp screenshot", it: "Screenshot SketchUp" },
  "upload.dropScreenshot": {
    en: "Drop your SketchUp screenshot here",
    it: "Trascina qui lo screenshot di SketchUp",
  },
  "upload.dropBrowse": {
    en: "Or click to browse your files",
    it: "Oppure clicca per sfogliare i file",
  },
  "upload.refTitle": { en: "Reference images", it: "Immagini di riferimento" },
  "upload.refSub": {
    en: "Upload renders, photos, or mood board images for inspiration. Two variant renders will be generated based on these references.",
    it: "Carica render, foto o immagini mood board per ispirazione. Due varianti di render saranno generate basandosi su questi riferimenti.",
  },
  "upload.refNotePlaceholder": {
    en: "What should we draw inspiration from? e.g. 'The warm timber ceiling proportions' or 'The stone wall texture and colour palette'",
    it: "Da cosa trarre ispirazione? es. 'Le proporzioni del soffitto in legno caldo' o 'La texture e la palette di colori della parete in pietra'",
  },
  "upload.addRef": { en: "Add reference images", it: "Aggiungi immagini di riferimento" },
  "upload.addRefSub": {
    en: "Drop multiple images or click to browse",
    it: "Trascina più immagini o clicca per sfogliare",
  },
  "upload.ready": { en: "Ready to generate?", it: "Pronto per generare?" },
  "upload.ready3": {
    en: "3 variants will be generated automatically (standard + 2 inspired). Takes ~3 minutes.",
    it: "3 varianti saranno generate automaticamente (standard + 2 ispirate). Circa 3 minuti.",
  },
  "upload.ready1": {
    en: "1 standard render will be generated. Add reference images above for 3 variants.",
    it: "1 render standard sarà generato. Aggiungi immagini di riferimento sopra per 3 varianti.",
  },
  "upload.generate": { en: "Generate renders", it: "Genera render" },
  "upload.feat1": { en: "Preserves your layout", it: "Preserva il tuo layout" },
  "upload.feat1sub": {
    en: "Walls, doors & windows stay exactly as drawn",
    it: "Muri, porte e finestre restano esattamente come disegnati",
  },
  "upload.feat2": { en: "3 design variants", it: "3 varianti di design" },
  "upload.feat2sub": {
    en: "Standard + 2 reference-inspired options",
    it: "Standard + 2 opzioni ispirate ai riferimenti",
  },
  "upload.feat3": { en: "High quality output", it: "Output di alta qualità" },
  "upload.feat3sub": {
    en: "Final render ready to share with clients",
    it: "Render finale pronto da condividere con i clienti",
  },
  "upload.accepted": { en: "PNG, JPG, WEBP accepted", it: "PNG, JPG, WEBP accettati" },

  // ── Loading ──
  "loading.wait": {
    en: "This may take up to a minute — please don't close the tab.",
    it: "Potrebbe richiedere fino a un minuto — non chiudere la scheda.",
  },
  "loading.standard": {
    en: "Generating standard render ({n}/{t})… You can leave your laptop.",
    it: "Generazione render standard ({n}/{t})… Puoi lasciare il portatile.",
  },
  "loading.variantA": {
    en: "Generating Variant A — reference-inspired ({n}/{t})…",
    it: "Generazione Variante A — ispirata ai riferimenti ({n}/{t})…",
  },
  "loading.variantB": {
    en: "Generating Variant B — creative interpretation ({n}/{t})…",
    it: "Generazione Variante B — interpretazione creativa ({n}/{t})…",
  },
  "loading.combining": {
    en: "Combining the best of each variant…",
    it: "Combinando il meglio di ogni variante…",
  },
  "loading.regenerating": {
    en: "Regenerating with your notes…",
    it: "Rigenerazione con le tue note…",
  },
  "loading.surfaces": {
    en: "Identifying surfaces in your space…",
    it: "Identificazione delle superfici nel tuo spazio…",
  },
  "loading.preview": {
    en: "Previewing surface {i} of {n}: {label}…",
    it: "Anteprima superficie {i} di {n}: {label}…",
  },
  "loading.describeMat": {
    en: "Describing material {i} of {n}: {label}…",
    it: "Descrizione materiale {i} di {n}: {label}…",
  },
  "loading.renderSurface": {
    en: "Rendering surface {i} of {n}: {label}…",
    it: "Rendering superficie {i} di {n}: {label}…",
  },
  "loading.preparing": {
    en: "Preparing your screenshot…",
    it: "Preparazione dello screenshot…",
  },
  "loading.converting": {
    en: "Converting your drawing to a realistic photo… (this takes about 30–60 seconds)",
    it: "Conversione del disegno in una foto realistica… (circa 30–60 secondi)",
  },

  // ── Error ──
  "error.title": { en: "Something went wrong", it: "Qualcosa è andato storto" },
  "error.retry": { en: "Try again", it: "Riprova" },
  "error.tooLarge": {
    en: "Image too large to process. Try a smaller or lower-resolution file.",
    it: "Immagine troppo grande. Prova un file più piccolo o a risoluzione inferiore.",
  },
  "error.uploadFirst": {
    en: "Please upload a SketchUp screenshot first.",
    it: "Carica prima uno screenshot di SketchUp.",
  },
  "error.noMaterial": {
    en: "Please upload at least one stone material photo.",
    it: "Carica almeno una foto di materiale in pietra.",
  },
  "error.noSurfaces": {
    en: "We couldn't find any suitable surfaces in this image. Try a cleaner screenshot with more visible walls or floor.",
    it: "Non siamo riusciti a trovare superfici adatte in questa immagine. Prova uno screenshot più pulito con muri o pavimento più visibili.",
  },
  "error.genFailed": {
    en: "Generation failed. Please try again.",
    it: "Generazione fallita. Riprova.",
  },
  "error.combineFailed": {
    en: "Combination failed. Please try again.",
    it: "Combinazione fallita. Riprova.",
  },
  "error.regenFailed": {
    en: "Regeneration failed. Please try again.",
    it: "Rigenerazione fallita. Riprova.",
  },
  "error.surfaceFailed": {
    en: "Surface detection failed. Please try again.",
    it: "Rilevamento superfici fallito. Riprova.",
  },
  "error.previewFailed": {
    en: "Preview generation failed. Please try again.",
    it: "Generazione anteprima fallita. Riprova.",
  },
  "error.finalFailed": {
    en: "Final render failed. Please try again.",
    it: "Render finale fallito. Riprova.",
  },

  // ── Variant review ──
  "variants.step": { en: "Step 1 of 5 — pick or combine", it: "Passo 1 di 5 — scegli o combina" },
  "variants.title": { en: "Review your render variants", it: "Rivedi le varianti del render" },
  "variants.sub": {
    en: "We generated {n} variant{s}. You can pick one directly or describe what to combine from each.",
    it: "Abbiamo generato {n} variante{s}. Puoi sceglierne una direttamente o descrivere cosa combinare da ciascuna.",
  },
  "variants.useThis": { en: "Use this one", it: "Usa questa" },
  "variants.combineTitle": { en: "Combine the best of each", it: "Combina il meglio di ciascuna" },
  "variants.combineSub": {
    en: "Describe what you like from each variant and we'll merge them into one render.",
    it: "Descrivi cosa ti piace di ogni variante e le uniremo in un unico render.",
  },
  "variants.combinePlaceholder": {
    en: "e.g. I like the wall proportions from Variant A, the floor material from Standard, and the ceiling warmth from Variant B…",
    it: "es. Mi piacciono le proporzioni delle pareti dalla Variante A, il materiale del pavimento dallo Standard e il calore del soffitto dalla Variante B…",
  },
  "variants.combineBtn": { en: "Combine into final base render", it: "Combina nel render base finale" },

  // ── Confirm base ──
  "confirm.step": { en: "Step 2 of 5", it: "Passo 2 di 5" },
  "confirm.title": { en: "Does the layout look right?", it: "Il layout sembra corretto?" },
  "confirm.sub": {
    en: "Check that the walls, doors, windows, and furniture positions match your drawing. The structure must be correct before we apply any materials.",
    it: "Verifica che le pareti, porte, finestre e la posizione dei mobili corrispondano al tuo disegno. La struttura deve essere corretta prima di applicare i materiali.",
  },
  "confirm.original": { en: "Your SketchUp drawing", it: "Il tuo disegno SketchUp" },
  "confirm.render": { en: "Photorealistic version", it: "Versione fotorealistica" },
  "confirm.fixTitle": { en: "Something look off?", it: "Qualcosa non va?" },
  "confirm.fixSub": {
    en: "Describe what needs fixing and we'll regenerate. Leave blank if it looks correct.",
    it: "Descrivi cosa va corretto e rigeneremo. Lascia vuoto se sembra corretto.",
  },
  "confirm.fixPlaceholder": {
    en: "e.g. The ceiling looks too low, or the window on the left is missing…",
    it: "es. Il soffitto sembra troppo basso, oppure manca la finestra a sinistra…",
  },
  "confirm.backVariants": { en: "← Back to variants", it: "← Torna alle varianti" },
  "confirm.regenerate": { en: "Regenerate with these notes", it: "Rigenera con queste note" },
  "confirm.approve": { en: "Looks correct — identify surfaces", it: "Sembra corretto — identifica superfici" },

  // ── Configure surfaces ──
  "config.step": { en: "Step 3 of 5", it: "Passo 3 di 5" },
  "config.title": { en: "Choose materials for each surface", it: "Scegli i materiali per ogni superficie" },
  "config.sub": {
    en: "We found {n} surface{s} in your space. Upload a material photo next to any surface you want to change — leave it blank to keep it as-is.",
    it: "Abbiamo trovato {n} superficie{s} nel tuo spazio. Carica una foto del materiale accanto a ogni superficie che vuoi cambiare — lascia vuoto per mantenerla com'è.",
  },
  "config.matUploaded": { en: "Material uploaded", it: "Materiale caricato" },
  "config.matApplied": { en: "Will be applied in the render", it: "Sarà applicato nel render" },
  "config.change": { en: "Change", it: "Cambia" },
  "config.uploadMat": { en: "Upload material photo", it: "Carica foto materiale" },
  "config.uploadMatSub": {
    en: "PNG, JPG, WEBP — product shot, swatch, screenshot",
    it: "PNG, JPG, WEBP — foto prodotto, campione, screenshot",
  },
  "config.back": { en: "← Back", it: "← Indietro" },
  "config.generatePreviews": { en: "Generate previews", it: "Genera anteprime" },

  // ── Review previews ──
  "review.step": { en: "Step 4 of 5 — almost there!", it: "Passo 4 di 5 — ci siamo quasi!" },
  "review.title": { en: "Here's a preview", it: "Ecco un'anteprima" },
  "review.sub": {
    en: "These are quick previews — the final render will be significantly higher quality. If you're happy with the direction, click 'Create final render' below.",
    it: "Queste sono anteprime rapide — il render finale sarà di qualità significativamente superiore. Se sei soddisfatto della direzione, clicca \"Crea render finale\" qui sotto.",
  },
  "review.preview": { en: "preview", it: "anteprima" },
  "review.happy": { en: "Happy with the direction?", it: "Soddisfatto della direzione?" },
  "review.happySub": {
    en: "The final render will be higher resolution and fully composited.",
    it: "Il render finale sarà a risoluzione più alta e completamente composito.",
  },
  "review.changeMats": { en: "← Change materials", it: "← Cambia materiali" },
  "review.setOptions": { en: "Set render options →", it: "Imposta opzioni render →" },

  // ── Render options ──
  "options.step": { en: "Step 5 of 5 — almost there!", it: "Passo 5 di 5 — ci siamo quasi!" },
  "options.title": { en: "Render options", it: "Opzioni render" },
  "options.sub": {
    en: "Fine-tune the lighting, mood, and atmosphere of your final render.",
    it: "Regola l'illuminazione, l'atmosfera e il mood del tuo render finale.",
  },
  "options.lighting": { en: "Lighting style", it: "Stile illuminazione" },
  "options.timeOfDay": { en: "Time of day", it: "Momento della giornata" },
  "options.mood": { en: "Mood", it: "Mood" },
  "options.camera": { en: "Camera style", it: "Stile fotocamera" },
  "options.location": { en: "Location", it: "Posizione" },
  "options.locationOptional": { en: "(optional)", it: "(opzionale)" },
  "options.locationSub": {
    en: "Sets the regional light quality, landscape, and exterior context visible through windows.",
    it: "Imposta la qualità della luce regionale, il paesaggio e il contesto esterno visibile dalle finestre.",
  },
  "options.locationPlaceholder": {
    en: "Search for a city or region…",
    it: "Cerca una città o regione…",
  },
  "options.ready": { en: "Ready to generate?", it: "Pronto per generare?" },
  "options.readySub": {
    en: "The final render takes 1–2 minutes at full quality.",
    it: "Il render finale richiede 1–2 minuti alla massima qualità.",
  },
  "options.backPreview": { en: "← Back to preview", it: "← Torna all'anteprima" },
  "options.createFinal": { en: "Create final render", it: "Crea render finale" },

  // Lighting options
  "opt.natural-daylight": { en: "Natural daylight", it: "Luce naturale diurna" },
  "opt.golden-hour": { en: "Golden hour", it: "Ora d'oro" },
  "opt.overcast": { en: "Overcast / diffused", it: "Nuvoloso / diffuso" },
  "opt.dramatic-spotlight": { en: "Dramatic spotlight", it: "Spotlight drammatico" },
  "opt.candlelight": { en: "Candlelight / warm ambient", it: "Luce di candela / ambiente caldo" },
  "opt.blue-hour": { en: "Blue hour / dusk", it: "Ora blu / crepuscolo" },
  "opt.night-interior": { en: "Night interior", it: "Interno notturno" },
  // Time of day
  "opt.morning": { en: "Morning", it: "Mattina" },
  "opt.midday": { en: "Midday", it: "Mezzogiorno" },
  "opt.afternoon": { en: "Afternoon", it: "Pomeriggio" },
  "opt.evening": { en: "Evening", it: "Sera" },
  "opt.night": { en: "Night", it: "Notte" },
  // Mood
  "opt.bright-airy": { en: "Bright & airy", it: "Luminoso e arioso" },
  "opt.warm-cosy": { en: "Warm & cosy", it: "Caldo e accogliente" },
  "opt.moody-dramatic": { en: "Moody & dramatic", it: "Atmosferico e drammatico" },
  "opt.clean-minimal": { en: "Clean & minimal", it: "Pulito e minimale" },
  "opt.luxurious-opulent": { en: "Luxurious & opulent", it: "Lussuoso e opulento" },
  "opt.rustic-natural": { en: "Rustic & natural", it: "Rustico e naturale" },
  // Camera
  "opt.wide-angle": { en: "Wide angle overview", it: "Panoramica grandangolare" },
  "opt.standard": { en: "Standard perspective", it: "Prospettiva standard" },
  "opt.intimate": { en: "Intimate close-up", it: "Primo piano intimo" },

  // Scale picker
  "scale.fine": { en: "Fine & detailed", it: "Fine e dettagliato" },
  "scale.fineSub": {
    en: "Small repeating tiles — great for bathrooms and backsplashes",
    it: "Piccole piastrelle ripetute — ideali per bagni e rivestimenti",
  },
  "scale.natural": { en: "Natural slab", it: "Lastra naturale" },
  "scale.naturalSub": {
    en: "Medium stone slabs — the most natural and versatile look",
    it: "Lastre di pietra medie — l'aspetto più naturale e versatile",
  },
  "scale.recommended": { en: "Recommended", it: "Consigliato" },
  "scale.statement": { en: "Statement walls", it: "Pareti d'effetto" },
  "scale.statementSub": {
    en: "Large dramatic slabs — bold, floor-to-ceiling impact",
    it: "Grandi lastre drammatiche — impatto audace dal pavimento al soffitto",
  },

  // ── Complete ──
  "complete.title": { en: "Your render is ready", it: "Il tuo render è pronto" },
  "complete.sub": {
    en: "High-quality photorealistic render with your stone material applied.",
    it: "Render fotorealistico di alta qualità con il tuo materiale in pietra applicato.",
  },
  "complete.download": { en: "Download render", it: "Scarica render" },
  "complete.newProject": { en: "Start a new project", it: "Inizia un nuovo progetto" },

  // ── Footer ──
  "footer.text": {
    en: "Tiba Render Studio — powered by Gemini & Claude",
    it: "Tiba Render Studio — powered by Gemini & Claude",
  },

  // ── Misc ──
  "misc.clickToChange": { en: "Click to change", it: "Clicca per cambiare" },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Lang): string {
  const entry = translations[key];
  return entry?.[lang] ?? entry?.en ?? key;
}
