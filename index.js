const axios = require('axios');
const fs = require('fs');
const env = require('dotenv');

env.config();

const API_URL = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('ERROR: Falta GITHUB_TOKEN en el archivo .env');
  process.exit(1);
}

// =====================================================================================
// PRESUPUESTOS DE TIEMPO
// =====================================================================================
const MAX_TIME_DESCUBRIMIENTO_REPOS = 3 * 60 * 1000;     // 3 min para armar el pool de repos
const MAX_TIME_BUSQUEDA_ORGS_GSOC   = 90 * 1000;          // 90s solo para la fase GSoC
const MAX_TIME_PROCESAMIENTO_ISSUES = 6 * 60 * 1000;      // 6 min para recorrer issues repo por repo
const MAX_ISSUES_COUNT              = 200;
const WAIT_TIME                     = 800;
const MIN_REPO_STARS                = 20;

// =====================================================================================
// FILTRO TEMPORAL DURO: solo issues creados en los últimos N días
// =====================================================================================
const MAX_DIAS_CREACION = 5;

// =====================================================================================
// OTROS LÍMITES
// =====================================================================================
const MAX_COMENTARIOS_HUMANOS_PERMITIDOS = 6;
const REPOS_POR_ORG_GSOC               = 3;
const MAX_ORGS_GSOC_POR_CORRIDA        = 40;

// =====================================================================================
// CACHE DE ORGS GSOC
// NOTA: subimos la versión del archivo de cache (v3) porque el formato de contenido
// cambió (ahora guardamos también los repos puntuales detectados vía code_url/project_url,
// separados de las orgs confirmadas). Si tenías un cache v2 viejo, no se reutiliza.
// =====================================================================================
const GSOC_ORGS_CACHE_FILE        = './gsoc-2026-orgs-cache-v3.json';
const GSOC_ORGS_CACHE_MAX_AGE_MS  = 24 * 60 * 60 * 1000; // 24 horas

const GSOC_2026_ORGS_FALLBACK = [];

// =====================================================================================
// REPOS DE COMUNIDAD MANUAL
// =====================================================================================
const REPOS_COMUNIDAD = [
  'meshery/meshery',
  'layer5io/meshery',
  'RocketChat/Rocket.Chat',
  'laurent22/joplin',
  'tooljet/ToolJet',
  'jellyfin/jellyfin',
  'CircuitVerse/CircuitVerse',
  'neovim/neovim',
  'oppia/oppia',
];

// =====================================================================================
// EXCLUSIONES MANUALES (orgs que no aceptan contribuidores nuevos por ahora)
// =====================================================================================
const ORGS_EXCLUIDAS = new Set(['laurent22']);

// Lista real de orgs GSoC 2026 (organizaciones completas verificadas), poblada en runtime.
let GSOC_2026_ORGS = GSOC_2026_ORGS_FALLBACK;

// FIX #1: lista separada de REPOS puntuales (no orgs enteras) detectados a partir de
// code_url / project_url de las ideas de proyecto GSoC. Estos NO arrastran el resto
// de la org paraguas a la que pertenecen.
let GSOC_2026_REPOS_PUNTUALES = new Set();

// =====================================================================================
// REGEX AUXILIARES
// =====================================================================================
const GSOC_LABEL_REGEX = /gsoc[\s'-]?\d{2,4}/i;

const GOOD_FIRST_ISSUE_LABEL_REGEX =
  /good[\s-]?first[\s-]?(issue|bug|pr|task)|\bbeginner([\s-]?friendly)?\b|^easy$|\beasy[\s-]?(fix|pick|task|win)\b|\bstarter\b|\bnewbie\b|first[\s-]?timers?[\s-]?only|hacktoberfest/i;

const BOT_LOGINS = new Set([
  'coderabbitai', 'github-actions', 'dependabot',
  'codecov-commenter', 'sonarqubecloud', 'vercel', 'netlify',
]);

const esBot = (login) => {
  if (!login) return false;
  const l = login.toLowerCase();
  return BOT_LOGINS.has(l) || l.endsWith('[bot]');
};

// =====================================================================================
// FILTRADO ANTI-ASIGNACIONES (EL CORAZÓN DEL SCRIPT)
//
// FIX #3: las regex anteriores tenían patrones demasiado sueltos ("on it!?", "may i",
// "i can work on") que hacían match dentro de frases sin relación a reclamar el issue
// (ej. "more info on it", "based on it", "I can work on this later if needed" dentro
// de una discusión técnica). Ahora:
//   - Exigimos límites de palabra (\b) en las frases cortas ambiguas.
//   - "on it" y "i got this" solo cuentan si son (casi) la frase completa del comentario,
//     no si aparecen incrustadas en medio de otra oración.
//   - Quitamos "may i" suelto (genera demasiados falsos positivos) y lo reemplazamos
//     por variantes más específicas ("may i take this", "may i work on this").
// =====================================================================================
const INTERES_CLAIM_REGEX =
  /\b(assign\s+me|i(?:'?m|'?ll)?\s*work\s+on\s+this|take\s+this\s+up|can\s+i\s+(?:take|do|fix|claim)\s+this|may\s+i\s+(?:take|work\s+on|claim|fix)\s+this|claim\s+this|please\s+assign\s+(?:me|this)|i\s+want\s+to\s+contribute|assign\s+this\s+to\s+me|interesado|me\s+interesa\s+(?:este|esta|tomar)|re-?assign\s+(?:it\s+)?to\s+me|i\s+can\s+work\s+on\s+this|i\s+would\s+like\s+to\s+work\s+on\s+this|let\s+me\s+(?:work\s+on|take|fix|handle)\s+this|starting\s+work\s+on\s+this|i(?:'m|\s+am)\s+(?:currently\s+)?working\s+on\s+this|i(?:'ll|\s+will)\s+(?:fix|take|work\s+on|handle|implement|tackle)\s+this|yo\s+lo\s+tomo|voy\s+a\s+(?:resolver|trabajar\s+en|tomar)\s+esto|puedo\s+(?:tomar|trabajar\s+en)\s+esto|quiero\s+trabajar\s+en\s+esto)\b/i;

// "on it" / "i got this" solo cuentan como reclamo si constituyen (casi) todo el
// comentario, no si aparecen incrustados en una oración más larga sin relación.
const SHORT_CLAIM_STANDALONE_REGEX = /^\s*(?:i'?m\s+)?on\s+it!?\s*$|^\s*i'?(?:ve got|got)\s+this!?\s*$/i;

const SELF_CLAIM_QA_REGEX =
  /(are you working on this\??|is anyone working on this\??)[^a-z0-9]{0,30}(yes|i am|i'm|sí|si)\b/i;

const MAINTAINER_INTENT_REGEX = /\bi (want to|plan to|will|am going to|intend to) implement\b/i;

const contieneSenalDeInteres = (texto) => {
  if (!texto) return false;
  const t = texto.trim();
  return (
    INTERES_CLAIM_REGEX.test(t) ||
    SELF_CLAIM_QA_REGEX.test(t) ||
    SHORT_CLAIM_STANDALONE_REGEX.test(t)
  );
};

// =====================================================================================
// CLIENTE HTTP CON MANEJO DE RATE LIMIT
// =====================================================================================
const axiosClient = axios.create({
  baseURL: API_URL,
  headers: {
    Authorization: `token ${TOKEN}`,
    Accept: 'application/vnd.github+json',
  },
});

const requestConRateLimit = async (config) => {
  try {
    return await axiosClient(config);
  } catch (error) {
    const status = error.response?.status;
    if (status === 403 || status === 429) {
      const resetHeader = error.response?.headers['x-ratelimit-reset'];
      if (resetHeader) {
        const resetMs = Number(resetHeader) * 1000 - Date.now() + 1000;
        if (resetMs > 0 && resetMs < 15 * 60 * 1000) {
          console.warn(`Rate limit alcanzado. Esperando ${Math.ceil(resetMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, resetMs));
          return await axiosClient(config);
        }
      }
    }
    throw error;
  }
};

// =====================================================================================
// UTILIDADES PARA DETECCIÓN DE ORGS GSOC
// =====================================================================================
const slugify      = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '');
const slugifyHyphen = (str) =>
  str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const IGNORAR_CANDIDATOS = new Set([
  'orgs', 'sponsors', 'settings', 'apps', 'marketplace', 'topics', 'about',
  'features', 'pricing', 'login', 'join', 'pages', 'collections', 'site',
]);

// Similaridad simple de strings (Dice coefficient sobre bigramas) para validar que un
// candidato de login de GitHub realmente se parece al nombre de la org GSoC. Evita
// confirmar orgs paraguas que no tienen relación real con el nombre de la org.
const bigramas = (str) => {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
};
const similaridad = (a, b) => {
  if (!a || !b) return 0;
  const ba = bigramas(a);
  const bb = bigramas(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let interseccion = 0;
  for (const bg of ba) if (bb.has(bg)) interseccion++;
  return (2 * interseccion) / (ba.size + bb.size);
};

// FIX #1: separamos claramente dos tipos de "candidato":
//   - candidatosOrg: vienen de org.url / blog_url / mailing_list / etc. y del propio
//     org.name. Estos SÍ pueden confirmarse como la org GitHub completa, pero solo si
//     superan un umbral de similaridad razonable con el nombre real de la org GSoC.
//   - candidatosRepoPuntual: vienen de project.code_url / project.project_url, que
//     apuntan a un REPO específico (a veces bajo una org paraguas ajena). Estos nunca
//     se usan para confirmar una org completa; como máximo agregan ESE repo puntual
//     al pool, etiquetado igual como GSoC oficial pero sin arrastrar al resto de la org.
const extraerCandidatos = (org) => {
  const candidatosOrg = new Set();
  const reposPuntuales = new Set(); // formato "owner/repo"

  const camposOrg = [
    org.url, org.blog_url, org.mailing_list, org.irc_channel, org.twitter_url,
  ].filter(Boolean).join(' ');

  const githubRegex = /github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/([A-Za-z0-9][A-Za-z0-9._-]*))?/gi;
  let match;
  while ((match = githubRegex.exec(camposOrg)) !== null) {
    candidatosOrg.add(match[1].replace(/\.git$/, ''));
  }

  const githubIoRegex = /https?:\/\/([A-Za-z0-9-]+)\.github\.io/gi;
  while ((match = githubIoRegex.exec(camposOrg)) !== null) {
    candidatosOrg.add(match[1]);
  }

  // project.code_url / project.project_url → SOLO repos puntuales, nunca orgs completas.
  for (const proyecto of (org.projects || [])) {
    const camposProyecto = [proyecto.code_url, proyecto.project_url].filter(Boolean).join(' ');
    const repoRegex = /github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)/gi;
    let m2;
    while ((m2 = repoRegex.exec(camposProyecto)) !== null) {
      const owner = m2[1];
      const repo  = m2[2].replace(/\.git$/, '');
      if (!IGNORAR_CANDIDATOS.has(owner.toLowerCase())) {
        reposPuntuales.add(`${owner}/${repo}`);
      }
    }
  }

  if (org.name) {
    candidatosOrg.add(slugify(org.name));
    candidatosOrg.add(slugifyHyphen(org.name));
  }

  const orgs = Array.from(candidatosOrg).filter(
    (c) => c && c.length > 1 && !IGNORAR_CANDIDATOS.has(c.toLowerCase())
  );

  return { candidatosOrg: orgs, reposPuntuales: Array.from(reposPuntuales) };
};

// Devuelve { login, type } o null. Necesitamos el "type" para descartar cuentas de
// usuario individuales que no son orgs, y evitar falsos positivos ahí también.
const verificarLoginGitHub = async (candidato) => {
  try {
    const response = await requestConRateLimit({ method: 'get', url: `/users/${candidato}` });
    if (!response.data?.login) return null;
    return { login: response.data.login, type: response.data.type };
  } catch {
    return null;
  }
};

// FIX #1: umbral mínimo de similaridad entre el candidato verificado y el nombre real
// de la org GSoC para aceptarlo como "la org completa". Si no supera el umbral, se
// descarta como org (no se listan sus repos completos) — aunque igual puede colarse
// como repo puntual si vino de code_url/project_url con owner/repo explícito.
const UMBRAL_SIMILARIDAD_ORG = 0.5;

// =====================================================================================
// DESCARGA Y CACHE DE ORGS GSOC 2026
// =====================================================================================
const obtenerOrgsGSoC2026 = async () => {
  try {
    if (fs.existsSync(GSOC_ORGS_CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(GSOC_ORGS_CACHE_FILE, 'utf-8'));
      const edadMs = Date.now() - new Date(cache.fetched_at).getTime();
      if (edadMs < GSOC_ORGS_CACHE_MAX_AGE_MS && Array.isArray(cache.orgs)) {
        console.log(`Usando cache de orgs GSoC 2026 (${cache.orgs.length} orgs, ${cache.repos_puntuales?.length || 0} repos puntuales, edad ${Math.round(edadMs / 60000)}min)`);
        GSOC_2026_REPOS_PUNTUALES = new Set(cache.repos_puntuales || []);
        return cache.orgs;
      }
    }
  } catch (error) {
    console.warn(`No se pudo leer cache de orgs GSoC: ${error.message}`);
  }

  try {
    console.log('Descargando lista oficial de orgs GSoC 2026 (api.gsocorganizations.dev)...');
    const response = await axios.get('https://api.gsocorganizations.dev/2026.json', {
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength:    50 * 1024 * 1024,
      timeout: 30000,
    });
    const organizaciones = response.data?.organizations || [];
    console.log(`${organizaciones.length} orgs GSoC 2026 recibidas de la API.`);

    // candidato -> { nombreOrgOriginal }
    const candidatosPorOrg = new Map();
    const reposPuntualesTotal = new Set();

    for (const org of organizaciones) {
      const { candidatosOrg, reposPuntuales } = extraerCandidatos(org);
      for (const candidato of candidatosOrg) {
        if (!candidatosPorOrg.has(candidato)) candidatosPorOrg.set(candidato, org.name);
      }
      for (const repoPuntual of reposPuntuales) reposPuntualesTotal.add(repoPuntual);
    }

    console.log(`${candidatosPorOrg.size} candidatos de ORG únicos a verificar contra GitHub...`);
    console.log(`${reposPuntualesTotal.size} repos puntuales detectados vía code_url/project_url (no se usan para confirmar orgs completas).`);

    const orgsVerificadas = new Set();
    let verificados = 0;
    let descartadosPorSimilaridad = 0;
    let descartadosPorTipo = 0;

    for (const [candidato, nombreOrgOriginal] of candidatosPorOrg.entries()) {
      const resultado = await verificarLoginGitHub(candidato);
      if (resultado) {
        if (resultado.type !== 'Organization') {
          descartadosPorTipo++;
        } else {
          const sim = similaridad(resultado.login, nombreOrgOriginal);
          if (sim >= UMBRAL_SIMILARIDAD_ORG) {
            orgsVerificadas.add(resultado.login);
          } else {
            descartadosPorSimilaridad++;
            console.log(`  ↳ Descartado "${resultado.login}" para org "${nombreOrgOriginal}" (similaridad ${sim.toFixed(2)} < ${UMBRAL_SIMILARIDAD_ORG})`);
          }
        }
      }
      verificados += 1;
      if (verificados % 50 === 0) {
        console.log(`  ...${verificados}/${candidatosPorOrg.size} candidatos verificados (${orgsVerificadas.size} confirmados)`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    console.log(`Descartados: ${descartadosPorTipo} por no ser Organization, ${descartadosPorSimilaridad} por baja similaridad de nombre.`);

    for (const slug of GSOC_2026_ORGS_FALLBACK) orgsVerificadas.add(slug);

    const orgs = Array.from(orgsVerificadas);
    const reposPuntuales = Array.from(reposPuntualesTotal);
    console.log(`✅ ${orgs.length} orgs completas confirmadas. ${reposPuntuales.length} repos puntuales adicionales.`);

    GSOC_2026_REPOS_PUNTUALES = new Set(reposPuntuales);
    fs.writeFileSync(
      GSOC_ORGS_CACHE_FILE,
      JSON.stringify({ fetched_at: new Date().toISOString(), orgs, repos_puntuales: reposPuntuales }, null, 2)
    );
    return orgs;
  } catch (error) {
    console.warn(`No se pudo obtener orgs GSoC 2026, usando fallback: ${error.message}`);
    return GSOC_2026_ORGS_FALLBACK;
  }
};

// =====================================================================================
// FASE 1: REPOS DE ORGS GSOC CONFIRMADAS (orgs completas)
// =====================================================================================
const getReposDeOrgsGSoC = async (unique) => {
  if (GSOC_2026_ORGS.length) {
    const orgsDisponibles = GSOC_2026_ORGS.filter((o) => !ORGS_EXCLUIDAS.has(o.toLowerCase()));
    const orgsAConsultar  = orgsDisponibles.slice(0, MAX_ORGS_GSOC_POR_CORRIDA);

    if (orgsDisponibles.length > orgsAConsultar.length) {
      console.log(`GSOC_2026_ORGS tiene ${orgsDisponibles.length} orgs; se consultarán ${orgsAConsultar.length} en esta corrida.`);
    }

    console.log(`Buscando repos dentro de ${orgsAConsultar.length} orgs GSoC 2026 (orgs completas confirmadas)...`);
    const inicioFaseGSoC = Date.now();

    for (const org of orgsAConsultar) {
      if (Date.now() - inicioFaseGSoC > MAX_TIME_BUSQUEDA_ORGS_GSOC) {
        console.warn(`Presupuesto de tiempo de la fase GSoC agotado. Pasando a repos puntuales / comunidad.`);
        break;
      }
      try {
        const response = await requestConRateLimit({
          method: 'get',
          url:    '/search/repositories',
          params: {
            q:        `org:${org} fork:false`,
            sort:     'updated',
            order:    'desc',
            per_page: REPOS_POR_ORG_GSOC,
          },
        });
        for (const repo of (response.data.items || [])) {
          if (!unique.has(repo.full_name)) {
            console.log(`  [GSoC-org] ${repo.full_name}`);
            unique.set(repo.full_name, { ...repo, _fuente: 'gsoc' });
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      } catch (error) {
        console.warn(`  No se pudieron buscar repos de org:${org}: ${error.message}`);
      }
    }
  }

  // FIX #1: repos puntuales detectados vía code_url/project_url. Se agregan
  // individualmente como GSoC oficial, SIN traer el resto de su org paraguas.
  if (GSOC_2026_REPOS_PUNTUALES.size) {
    console.log(`Añadiendo ${GSOC_2026_REPOS_PUNTUALES.size} repos puntuales GSoC (vía code_url/project_url)...`);
    for (const fullName of GSOC_2026_REPOS_PUNTUALES) {
      if (unique.has(fullName)) continue;
      const org = fullName.split('/')[0].toLowerCase();
      if (ORGS_EXCLUIDAS.has(org)) continue;
      try {
        const response = await requestConRateLimit({ method: 'get', url: `/repos/${fullName}` });
        const repo = response.data;
        console.log(`  [GSoC-repo-puntual] ${repo.full_name}`);
        unique.set(repo.full_name, { ...repo, _fuente: 'gsoc' });
        await new Promise((r) => setTimeout(r, 200));
      } catch (error) {
        console.warn(`  No se pudo obtener repo puntual GSoC ${fullName}: ${error.message}`);
      }
    }
  }
};

// =====================================================================================
// FASE 2: REPOS DE COMUNIDAD MANUAL
// =====================================================================================
const getReposComunidadManual = async (unique) => {
  console.log(`Añadiendo ${REPOS_COMUNIDAD.length} repos de la lista manual de Comunidad...`);

  for (const fullName of REPOS_COMUNIDAD) {
    if (unique.has(fullName)) continue;
    const org = fullName.split('/')[0].toLowerCase();
    if (ORGS_EXCLUIDAS.has(org)) {
      console.log(`  [Comunidad] ${fullName} → SALTADO (org excluida)`);
      continue;
    }
    try {
      const response = await requestConRateLimit({ method: 'get', url: `/repos/${fullName}` });
      const repo = response.data;
      console.log(`  [Comunidad] ${repo.full_name}`);
      unique.set(repo.full_name, { ...repo, _fuente: 'comunidad' });
      await new Promise((r) => setTimeout(r, 200));
    } catch (error) {
      console.warn(`  No se pudo obtener repo ${fullName}: ${error.message}`);
    }
  }
};

// =====================================================================================
// FASE 3: POOL GENÉRICO (comunidad amplia, TODOS los lenguajes de GitHub)
// NOTA: antes esta fase restringía la búsqueda a language:JavaScript. Se quitó ese
// filtro para que el descubrimiento cubra repos de cualquier lenguaje/stack en todo
// GitHub. "good first issue" sigue siendo solo una etiqueta por issue (es_good_first_issue),
// nunca un requisito para que un issue entre al pool — eso se filtra en el frontend.
// =====================================================================================
const getCandidateRepos = async () => {
  const sorts     = ['updated', 'stars'];
  const per_page  = 50;
  const unique    = new Map();
  const inicioDescubrimiento = Date.now();

  await getReposDeOrgsGSoC(unique);
  await getReposComunidadManual(unique);

  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const oneMonthAgoStr = oneMonthAgo.toISOString().split('T')[0];

  for (const sort of sorts) {
    for (let page = 1; page <= 2; page++) {
      if (Date.now() - inicioDescubrimiento > MAX_TIME_DESCUBRIMIENTO_REPOS) {
        console.warn('Presupuesto de tiempo de descubrimiento agotado. Cerrando fase genérica.');
        return unique;
      }
      try {
        const response = await requestConRateLimit({
          method: 'get',
          url:    '/search/repositories',
          params: {
            q:        `fork:false stars:>${MIN_REPO_STARS} pushed:>${oneMonthAgoStr}`,
            sort,
            order:    'desc',
            per_page,
            page,
          },
        });
        for (const repo of (response.data.items || [])) {
          if (!unique.has(repo.full_name)) {
            console.log(repo.full_name);
            unique.set(repo.full_name, { ...repo, _fuente: 'comunidad' });
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      } catch (error) {
        console.error(`Failed to fetch repos sort=${sort} page=${page}: ${error.message}`);
        break;
      }
    }
  }

  return unique;
};

// =====================================================================================
// DETECCIÓN DE PR VINCULADO (timeline + búsqueda)
// =====================================================================================
const tienePRVinculadoTimeline = async (repoFullName, issueNumber) => {
  try {
    const response = await requestConRateLimit({
      method:  'get',
      url:     `/repos/${repoFullName}/issues/${issueNumber}/timeline`,
      headers: { Accept: 'application/vnd.github.mockingbird-preview+json' },
    });
    return (response.data || []).some(
      (ev) =>
        (ev.event === 'cross-referenced' && ev.source?.issue?.pull_request) ||
        ev.event === 'connected'
    );
  } catch (error) {
    console.warn(`No se pudo leer timeline de ${repoFullName}#${issueNumber}: ${error.message}`);
    return false;
  }
};

const tienePRVinculadoBusqueda = async (repoFullName, issueNumber) => {
  try {
    const query = `repo:${repoFullName} is:pr (closes #${issueNumber} OR fixes #${issueNumber} OR resolves #${issueNumber})`;
    const response = await requestConRateLimit({
      method: 'get',
      url:    '/search/issues',
      params: { q: query },
    });
    return (response.data.total_count || 0) > 0;
  } catch (error) {
    console.warn(`No se pudo buscar PRs de ${repoFullName}#${issueNumber}: ${error.message}`);
    return false;
  }
};

const tienePRVinculado = async (repoFullName, issueNumber) => {
  const [porTimeline, porBusqueda] = await Promise.all([
    tienePRVinculadoTimeline(repoFullName, issueNumber),
    tienePRVinculadoBusqueda(repoFullName, issueNumber),
  ]);
  return porTimeline || porBusqueda;
};

// =====================================================================================
// ANÁLISIS DE HILO COMPLETO (body + comentarios humanos)
// =====================================================================================
const analizarHiloCompleto = async (repoFullName, issueNumber, body, totalComments) => {
  if (contieneSenalDeInteres(body)) return { huboInteres: true, count: 0 };
  if (totalComments === 0) return { huboInteres: false, count: 0 };

  try {
    const response = await requestConRateLimit({
      method: 'get',
      url:    `/repos/${repoFullName}/issues/${issueNumber}/comments`,
      params: { per_page: 100 },
    });
    const comentariosHumanos = (response.data || []).filter((c) => !esBot(c.user?.login));

    for (const comentario of comentariosHumanos) {
      if (contieneSenalDeInteres(comentario.body)) {
        return { huboInteres: true, count: comentariosHumanos.length };
      }
    }

    return { huboInteres: false, count: comentariosHumanos.length };
  } catch (error) {
    console.warn(`No se pudo leer comentarios de ${repoFullName}#${issueNumber}: ${error.message}`);
    return { huboInteres: true, count: totalComments };
  }
};

// =====================================================================================
// FILTRADO PRINCIPAL DE ISSUES
// =====================================================================================
const getFilteredIssues = async (repo) => {
  const orgDelRepo = repo.full_name.split('/')[0].toLowerCase();
  if (ORGS_EXCLUIDAS.has(orgDelRepo)) {
    console.log(`Saltando ${repo.full_name}: org excluida manualmente.`);
    return [];
  }

  try {
    const response = await requestConRateLimit({
      method: 'get',
      url:    `/repos/${repo.full_name}/issues`,
      params: {
        state:    'open',
        sort:     'created',
        direction:'desc',
        per_page: 100,
      },
    });

    const ahora   = new Date();
    const umbralCreacion = new Date(ahora.getTime() - MAX_DIAS_CREACION * 24 * 60 * 60 * 1000);

    const filtered = [];

    for (const issue of response.data) {
      if (issue.pull_request) continue;

      const creadoEn = new Date(issue.created_at);
      if (creadoEn < umbralCreacion) {
        console.log(`  ↳ Issue #${issue.number} creado ${issue.created_at.slice(0,10)} → fuera del rango de ${MAX_DIAS_CREACION} días. Saltando repo.`);
        break;
      }

      if (issue.assignee !== null || (issue.assignees && issue.assignees.length > 0)) continue;

      const etiquetas = (issue.labels || [])
        .map((l) => (l && l.name ? l.name.toLowerCase() : ''))
        .filter(Boolean);

      if (etiquetas.some((tag) => tag === 'stale' || tag.includes('stale'))) continue;

      const tieneLabelGSoC   = etiquetas.some((tag) => GSOC_LABEL_REGEX.test(tag));
      const esGoodFirstIssue = etiquetas.some((tag) => GOOD_FIRST_ISSUE_LABEL_REGEX.test(tag));

      // FIX #1 (continuación): esGSoCOficial ahora depende de una fuente confiable
      // ('gsoc' viene de org confirmada o repo puntual verificado individualmente,
      // nunca de "la org también aparece en la lista por otro repo suyo").
      // La rama muerta anterior (repo._fuente !== 'comunidad' && GSOC_2026_ORGS.some(...))
      // fue eliminada: era inalcanzable y no aportaba protección real.
      const esGSoCOficial = repo._fuente === 'gsoc' || tieneLabelGSoC;

      const authorAssociation = (issue.author_association || '').toUpperCase();
      const autorEsMantenedor = ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(authorAssociation);
      if (autorEsMantenedor && MAINTAINER_INTENT_REGEX.test(issue.body || '')) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }

      const analisis = await analizarHiloCompleto(repo.full_name, issue.number, issue.body, issue.comments);
      if (analisis.huboInteres) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }

      if (analisis.count > MAX_COMENTARIOS_HUMANOS_PERMITIDOS) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }

      const prVinculado = await tienePRVinculado(repo.full_name, issue.number);
      if (prVinculado) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }

      const estrategiaTag = esGSoCOficial ? '100% LIBRE - GSOC OFICIAL' : '100% LIBRE - COMUNIDAD';

      issue.estrategia_placement           = estrategiaTag;
      issue.es_gsoc_oficial                = esGSoCOficial;
      issue.es_good_first_issue            = esGoodFirstIssue;
      issue.comentarios_humanos_count      = analisis.count;
      filtered.push(issue);

      await new Promise((r) => setTimeout(r, 200));
    }

    return filtered;
  } catch (error) {
    console.error(`Failed to fetch issues for ${repo.full_name}: ${error.message}`);
    return [];
  }
};

// =====================================================================================
// GENERACIÓN DEL HTML INTERACTIVO
// (idéntico al original, salvo FIX #4 en classifyStack)
// =====================================================================================
const generarHTML = (flatItems, generatedAt) => {
  const itemsJSON = JSON.stringify(flatItems);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GSoC 2026 Issue Hunter</title>
<style>
  :root {
    --bg:        #0d1117;
    --surface:   #161b22;
    --surface2:  #1c2230;
    --border:    #30363d;
    --text:      #e6edf3;
    --text-muted:#8b949e;
    --accent:    #58a6ff;
    --green:     #3fb950;
    --orange:    #f0883e;
    --purple:    #bc8cff;
    --red:       #f85149;
    --radius:    8px;
    --toolbar-h: 112px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    line-height: 1.5;
  }
  #toolbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 100;
    background: rgba(13,17,23,0.92);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .toolbar-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  #toolbar h1 { font-size: 15px; font-weight: 700; color: var(--accent); letter-spacing: -0.3px; flex-shrink: 0; }
  #issue-count { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
  #btn-update {
    margin-left: auto; flex-shrink: 0; background: var(--accent); color: #0d1117;
    border: none; border-radius: var(--radius); padding: 5px 13px; font-size: 12px;
    font-weight: 700; cursor: pointer; transition: opacity 0.15s;
  }
  #btn-update:disabled { opacity: 0.45; cursor: not-allowed; }
  #btn-update.running  { background: var(--orange); }
  #log-panel {
    display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 200;
    background: #0a0e14; border-top: 1px solid var(--border); max-height: 220px;
  }
  #log-header {
    display: flex; align-items: center; justify-content: space-between; padding: 6px 14px;
    border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-muted);
    cursor: pointer; user-select: none;
  }
  #log-header span { font-weight: 600; color: var(--text); }
  #log-body {
    overflow-y: auto; max-height: 170px; padding: 8px 14px;
    font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11.5px;
    line-height: 1.6; color: #8b949e;
  }
  #log-body .log-line { white-space: pre-wrap; word-break: break-all; }
  #log-body .log-done-ok  { color: var(--green); font-weight: 700; }
  #log-body .log-done-err { color: var(--red);   font-weight: 700; }
  #search {
    flex: 1; min-width: 180px; background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text); padding: 6px 10px; font-size: 13px;
    outline: none; transition: border-color 0.15s;
  }
  #search:focus { border-color: var(--accent); }
  #search::placeholder { color: var(--text-muted); }
  #org-select {
    flex-shrink: 0; background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text); padding: 6px 10px; font-size: 12px;
    outline: none; cursor: pointer; transition: border-color 0.15s; max-width: 220px;
  }
  #org-select:hover  { border-color: #444c56; }
  #org-select:focus  { border-color: var(--accent); }
  #org-select option { background: var(--surface2); color: var(--text); }
  .btn-group { display: flex; gap: 4px; flex-wrap: wrap; }
  .btn {
    border: 1px solid var(--border); background: var(--surface2); color: var(--text-muted);
    padding: 5px 11px; border-radius: 20px; font-size: 12px; cursor: pointer;
    transition: all 0.15s; white-space: nowrap;
  }
  .btn:hover    { border-color: var(--accent); color: var(--text); }
  .btn.active   { background: var(--accent); border-color: var(--accent); color: #0d1117; font-weight: 600; }
  .btn.sort-btn { border-radius: var(--radius); font-size: 12px; }
  #main { max-width: 900px; margin: 0 auto; padding: calc(var(--toolbar-h) + 20px) 16px 40px; }
  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px 16px; margin-bottom: 10px; transition: border-color 0.15s, transform 0.1s;
  }
  .card:hover { border-color: #444c56; transform: translateY(-1px); }
  .card-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
  .badge-type {
    flex-shrink: 0; font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
    padding: 2px 7px; border-radius: 20px; text-transform: uppercase; margin-top: 2px;
  }
  .badge-gsoc     { background: rgba(88,166,255,0.15); color: var(--accent); border: 1px solid rgba(88,166,255,0.3); }
  .badge-comunidad{ background: rgba(63,185,80,0.15);  color: var(--green);  border: 1px solid rgba(63,185,80,0.3);  }
  .badge-fe       { background: rgba(188,140,255,0.12); color: var(--purple); border: 1px solid rgba(188,140,255,0.3); }
  .badge-be       { background: rgba(240,136,62,0.12);  color: var(--orange); border: 1px solid rgba(240,136,62,0.3);  }
  .badge-fs       { background: rgba(248,81,73,0.10);   color: #f0883e;       border: 1px solid rgba(248,81,73,0.2);   }
  .badge-stack    { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border); }
  .badge-gfi      { background: rgba(63,185,80,0.15); color: var(--green); border: 1px solid rgba(63,185,80,0.35); }
  .card-title a { color: var(--text); text-decoration: none; font-weight: 600; font-size: 14px; line-height: 1.4; }
  .card-title a:hover { color: var(--accent); }
  .card-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }
  .repo-link { color: var(--text-muted); text-decoration: none; }
  .repo-link:hover { color: var(--accent); text-decoration: underline; }
  .meta-dot::before { content: '·'; margin-right: 2px; }
  .labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .label {
    font-size: 11px; padding: 1px 7px; border-radius: 20px; border: 1px solid transparent;
    background: var(--surface2); color: var(--text-muted);
  }
  .label.gfi { background: rgba(63,185,80,0.1); color: var(--green); border-color: rgba(63,185,80,0.2); }
  .comments-badge { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 3px; }
  #empty { display: none; text-align: center; color: var(--text-muted); padding: 60px 20px; font-size: 14px; }
  @media (max-width: 600px) {
    :root { --toolbar-h: 140px; }
    #toolbar h1 { font-size: 13px; }
    .card { padding: 12px 12px; }
  }
</style>
</head>
<body>

<div id="toolbar">
  <div class="toolbar-row">
    <h1>🎯 GSoC 2026 Issue Hunter</h1>
    <input id="search" type="search" placeholder="Buscar por título, repo o etiqueta…" autocomplete="off">
    <span id="issue-count"></span>
    <button id="btn-update" title="Ejecutar el script y recargar resultados">🔄 Actualizar</button>
  </div>
  <div class="toolbar-row">
    <div class="btn-group" id="filter-btns">
      <button class="btn active" data-filter="all">Todos</button>
      <button class="btn" data-filter="gsoc">Solo GSoC Oficial</button>
      <button class="btn" data-filter="comunidad">Solo Comunidad</button>
    </div>
    <button class="btn" id="gfi-toggle" title="Mostrar solo issues marcados como Good First Issue">🌱 Solo Good First Issues</button>
    <div class="btn-group" id="stack-btns">
      <button class="btn active" data-stack="all">Cualquier stack</button>
      <button class="btn" data-stack="frontend">🎨 Frontend</button>
      <button class="btn" data-stack="backend">⚙️ Backend</button>
      <button class="btn" data-stack="fullstack">🔀 Full Stack</button>
      <button class="btn" data-stack="other">📦 Sin clasificar</button>
    </div>
    <select id="org-select" title="Filtrar por organización">
      <option value="all">Todas las organizaciones</option>
    </select>
    <button class="btn sort-btn" id="sort-btn" data-order="desc">⬆ Más recientes primero</button>
  </div>
</div>

<div id="main">
  <div id="cards"></div>
  <div id="empty">No se encontraron issues que coincidan con tu búsqueda.</div>
</div>

<div id="log-panel">
  <div id="log-header">
    <span id="log-title">Logs de actualización</span>
    <span id="log-toggle">▼ ocultar</span>
  </div>
  <div id="log-body"></div>
</div>

<script>
(function () {
  const RAW = ${itemsJSON};

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('es-CL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };
  const timeAgo = (iso) => {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1)  return 'hace unos minutos';
    if (h < 24) return \`hace \${h}h\`;
    return \`hace \${Math.floor(h/24)}d\`;
  };
  const esc = (s) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  let sortOrder  = 'desc';
  let filterType = 'all';
  let stackFilter = 'all';
  let orgFilter  = 'all';
  let gfiOnly    = false;
  let searchQ    = '';

  // FIX #4: eliminamos el fallback que forzaba TODO repo JS/TS sin match de
  // keywords a "fullstack". Ahora, si no hay señal clara de frontend/backend
  // en labels/título, el issue queda en 'other' ("Sin clasificar") en vez de
  // mentir diciendo que es Full Stack. Esto hace que los filtros de
  // Frontend/Backend/Full Stack reflejen señales reales, no un default arbitrario.
  const FRONTEND_RE = /\\b(frontend|front.end|ui|ux|css|html|react|vue|angular|svelte|next|nuxt|tailwind|design|component|template|layout|style|visual|accessibility|a11y|responsive)\\b/i;
  const BACKEND_RE  = /\\b(backend|back.end|api|server|database|db|sql|migration|auth|authentication|endpoint|rest|graphql|grpc|worker|queue|cache|redis|docker|k8s|kubernetes|cli|infra|devops|\\bci\\b|\\bcd\\b|performance|security|logging|monitoring)\\b/i;

  const classifyStack = (item) => {
    const labelStr  = (item.labels || []).join(' ').toLowerCase();
    const titleStr  = (item.title || '').toLowerCase();
    const fe = FRONTEND_RE.test(labelStr) || FRONTEND_RE.test(titleStr);
    const be = BACKEND_RE.test(labelStr)  || BACKEND_RE.test(titleStr);
    if (fe && be) return 'fullstack';
    if (fe)       return 'frontend';
    if (be)       return 'backend';
    return 'other';
  };

  const applyFilters = () => {
    let items = RAW.slice();

    if (filterType === 'gsoc')     items = items.filter(i => i.es_gsoc_oficial);
    if (filterType === 'comunidad') items = items.filter(i => !i.es_gsoc_oficial);

    if (stackFilter !== 'all') {
      items = items.filter(i => classifyStack(i) === stackFilter);
    }

    if (orgFilter !== 'all') {
      items = items.filter(i => i.org === orgFilter);
    }

    if (gfiOnly) {
      items = items.filter(i => i.es_good_first_issue);
    }

    if (searchQ) {
      const q = searchQ.toLowerCase();
      items = items.filter(i =>
        (i.title||'').toLowerCase().includes(q) ||
        (i.repo||'').toLowerCase().includes(q)  ||
        (i.labels||[]).some(l => l.toLowerCase().includes(q))
      );
    }

    items.sort((a, b) => {
      const ta = new Date(a.created_at||0).getTime();
      const tb = new Date(b.created_at||0).getTime();
      return sortOrder === 'desc' ? tb - ta : ta - tb;
    });

    return items;
  };

  const buildCard = (item) => {
    const isGSoC = item.es_gsoc_oficial;
    const badgeClass = isGSoC ? 'badge-gsoc' : 'badge-comunidad';
    const badgeText  = isGSoC ? '100% LIBRE · GSOC OFICIAL' : '100% LIBRE · COMUNIDAD';
    const stack = classifyStack(item);
    const stackMap = {
      frontend:  { cls: 'badge-fe',    label: '🎨 Frontend'  },
      backend:   { cls: 'badge-be',    label: '⚙️ Backend'   },
      fullstack: { cls: 'badge-fs',    label: '🔀 Full Stack' },
      other:     { cls: 'badge-stack', label: '📦 Sin clasificar' },
    };
    const { cls: stackCls, label: stackLabel } = stackMap[stack] || stackMap.other;

    const labelsHtml = (item.labels||[]).map(l => {
      const isGFI = /good.first|beginner|starter|easy|newbie/i.test(l);
      return \`<span class="label\${isGFI?' gfi':''}">\${esc(l)}</span>\`;
    }).join('');

    const repoUrl = \`https://github.com/\${esc(item.repo)}\`;

    return \`
<div class="card"
     data-gsoc="\${isGSoC?'1':'0'}"
     data-created="\${item.created_at||''}"
     data-title="\${esc(item.title)}"
     data-repo="\${esc(item.repo)}"
     data-labels="\${esc((item.labels||[]).join(' '))}">
  <div class="card-header">
    <span class="badge-type \${badgeClass}">\${badgeText}</span>
    <span class="badge-type \${stackCls}">\${stackLabel}</span>
    \${item.es_good_first_issue ? '<span class="badge-type badge-gfi">🌱 GOOD FIRST ISSUE</span>' : ''}
    <div class="card-title">
      <a href="\${esc(item.html_url)}" target="_blank" rel="noopener">\${esc(item.title)}</a>
    </div>
  </div>
  <div class="card-meta">
    <a class="repo-link" href="\${repoUrl}" target="_blank" rel="noopener">\${esc(item.repo)}</a>
    <span class="meta-dot">\${esc(item.repo_name||'')}</span>
    <span title="\${esc(item.created_at)}">📅 \${fmt(item.created_at)} (\${timeAgo(item.created_at)})</span>
    \${item.comentarios_humanos_count != null
      ? \`<span class="comments-badge">💬 \${item.comentarios_humanos_count} comentarios</span>\`
      : ''}
    \${item.repo_stars != null ? \`<span>⭐ \${item.repo_stars.toLocaleString()}</span>\` : ''}
  </div>
  \${labelsHtml ? \`<div class="labels">\${labelsHtml}</div>\` : ''}
</div>\`;
  };

  const render = () => {
    const items   = applyFilters();
    const countEl = document.getElementById('issue-count');
    const cardsEl = document.getElementById('cards');
    const emptyEl = document.getElementById('empty');

    countEl.textContent = \`\${items.length} issue\${items.length !== 1 ? 's' : ''} encontrado\${items.length !== 1 ? 's' : ''}\`;
    cardsEl.innerHTML   = items.map(buildCard).join('');
    emptyEl.style.display = items.length === 0 ? 'block' : 'none';
  };

  document.getElementById('search').addEventListener('input', (e) => {
    searchQ = e.target.value.trim();
    render();
  });

  document.getElementById('filter-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    document.querySelectorAll('#filter-btns .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterType = btn.dataset.filter;
    render();
  });

  document.getElementById('stack-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    document.querySelectorAll('#stack-btns .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    stackFilter = btn.dataset.stack;
    render();
  });

  document.getElementById('gfi-toggle').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    gfiOnly = !gfiOnly;
    btn.classList.toggle('active', gfiOnly);
    render();
  });

  document.getElementById('sort-btn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    btn.dataset.order  = sortOrder;
    btn.textContent    = sortOrder === 'desc' ? '⬆ Más recientes primero' : '⬇ Más antiguos primero';
    render();
  });

  const orgSelect = document.getElementById('org-select');
  const uniqueOrgs = Array.from(new Set(RAW.map(i => i.org).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  uniqueOrgs.forEach((org) => {
    const opt = document.createElement('option');
    opt.value = org;
    opt.textContent = org;
    orgSelect.appendChild(opt);
  });

  orgSelect.addEventListener('change', (e) => {
    orgFilter = e.target.value;
    render();
  });

  render();

  const btnUpdate  = document.getElementById('btn-update');
  const logPanel   = document.getElementById('log-panel');
  const logBody    = document.getElementById('log-body');
  const logTitle   = document.getElementById('log-title');
  const logToggle  = document.getElementById('log-toggle');
  let logCollapsed = false;

  document.getElementById('log-header').addEventListener('click', () => {
    logCollapsed = !logCollapsed;
    logBody.style.display  = logCollapsed ? 'none' : '';
    logToggle.textContent  = logCollapsed ? '▲ mostrar' : '▼ ocultar';
  });

  const appendLog = (text, cls) => {
    const line = document.createElement('div');
    line.className = 'log-line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    logBody.appendChild(line);
    logBody.scrollTop = logBody.scrollHeight;
  };

  fetch('/status').then(r => r.json()).then(({ running }) => {
    if (running) btnUpdate.disabled = true;
  }).catch(() => {
    btnUpdate.style.display = 'none';
  });

  btnUpdate.addEventListener('click', () => {
    btnUpdate.disabled   = true;
    btnUpdate.classList.add('running');
    btnUpdate.textContent = '⏳ Actualizando…';
    logBody.innerHTML    = '';
    logCollapsed         = false;
    logBody.style.display = '';
    logToggle.textContent = '▼ ocultar';
    logPanel.style.display = 'block';
    logTitle.textContent   = 'Actualizando resultados…';

    const es = new EventSource('/run-sse');
    es.close();

    fetch('/run', { method: 'POST' })
      .then(async (response) => {
        if (!response.ok && response.status === 409) {
          appendLog('⚠️ Ya hay una actualización en curso, espera a que termine.', '');
          btnUpdate.disabled   = false;
          btnUpdate.classList.remove('running');
          btnUpdate.textContent = '🔄 Actualizar';
          logTitle.textContent  = 'Logs de actualización';
          return;
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        const parseSSE = (chunk) => {
          buffer += chunk;
          const parts = buffer.split('\\n\\n');
          buffer = parts.pop();
          for (const part of parts) {
            const eventMatch = part.match(/^event:\\s*(.+)$/m);
            const dataMatch  = part.match(/^data:\\s*(.+)$/m);
            if (!dataMatch) continue;
            let payload;
            try { payload = JSON.parse(dataMatch[1]); } catch { continue; }
            const eventType = eventMatch ? eventMatch[1].trim() : 'message';

            if (eventType === 'log') {
              appendLog(payload.text);
            } else if (eventType === 'done') {
              const cls = payload.ok ? 'log-done-ok' : 'log-done-err';
              appendLog(payload.text, cls);
              logTitle.textContent = payload.ok ? '✅ Actualización completada' : '❌ Error en la actualización';
              btnUpdate.disabled   = false;
              btnUpdate.classList.remove('running');
              btnUpdate.textContent = '🔄 Actualizar';

              if (payload.ok) {
                setTimeout(() => window.location.reload(), 1500);
              }
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parseSSE(decoder.decode(value, { stream: true }));
        }
      })
      .catch((err) => {
        appendLog(\`❌ No se pudo conectar con el servidor: \${err.message}\`, 'log-done-err');
        logTitle.textContent  = 'Error de conexión';
        btnUpdate.disabled   = false;
        btnUpdate.classList.remove('running');
        btnUpdate.textContent = '🔄 Actualizar';
      });
  });
})();
</script>
</body>
</html>`;
};

// =====================================================================================
// FUNCIÓN PRINCIPAL
// =====================================================================================
const getGoodFirstIssues = async () => {
  try {
    let allIssues  = [];
    let issuesCount = 0;
    const start    = Date.now();

    const uniqueRepos = await getCandidateRepos();

    for (const repo of uniqueRepos.values()) {
      if (Date.now() - start > MAX_TIME_PROCESAMIENTO_ISSUES || issuesCount >= MAX_ISSUES_COUNT) break;
      console.log(`Fetching issues for ${repo.full_name}`);
      const issues = await getFilteredIssues(repo);

      if (issues.length > 0) {
        const [org, repoName] = repo.full_name.split('/');
        const metrics = {
          stars:       repo.stargazers_count,
          forks:       repo.forks_count,
          open_issues: repo.open_issues_count,
          pushed_at:   repo.pushed_at,
          updated_at:  repo.updated_at,
          language:    repo.language,
        };

        for (const item of issues) {
          allIssues.push({
            id:                       item.id,
            title:                    item.title,
            html_url:                 item.html_url,
            created_at:               item.created_at,
            updated_at:               item.updated_at,
            labels:                   (item.labels || []).map((l) => l && l.name).filter(Boolean),
            repo:                     repo.full_name,
            org,
            repo_name:                repoName,
            repo_stars:               metrics.stars,
            repo_forks:               metrics.forks,
            repo_pushed_at:           metrics.pushed_at,
            estrategia:               item.estrategia_placement,
            es_gsoc_oficial:          item.es_gsoc_oficial,
            es_good_first_issue:      item.es_good_first_issue,
            comentarios_humanos_count:item.comentarios_humanos_count,
            repo_language:            metrics.language || null,
          });
          issuesCount += 1;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, WAIT_TIME));
    }

    allIssues.sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const jsonOut = { generated_at: new Date().toISOString(), items: allIssues };
    fs.writeFileSync('./issues.json', JSON.stringify(jsonOut, null, 2));
    console.log(`✅ issues.json generado con ${allIssues.length} issues.`);

    const html = generarHTML(allIssues, new Date().toISOString());
    fs.writeFileSync('./index.html', html);
    console.log(`✅ index.html generado (panel interactivo).`);

    let markdown = `# GSoC 2026 Issue Hunter — Issues 100% Libres\n\n`;
    markdown += `> Generado automáticamente el ${new Date().toLocaleString('es-CL')}.\n\n`;
    markdown += `## Resumen\n\n`;
    markdown += `- **Total de issues libres:** ${allIssues.length}\n`;
    markdown += `- **GSoC Oficial:** ${allIssues.filter(i => i.es_gsoc_oficial).length}\n`;
    markdown += `- **Comunidad:** ${allIssues.filter(i => !i.es_gsoc_oficial).length}\n\n`;
    markdown += `---\n\n`;

    for (const item of allIssues) {
      const marca = item.es_gsoc_oficial ? '🎯' : '🌐';
      markdown += `- ${marca} **[${item.estrategia}]** [${item.repo}] [${item.title}](${item.html_url})\n`;
    }

    fs.writeFileSync('ISSUES.md', markdown);
    console.log(`✅ ISSUES.md generado.`);

  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
    process.exit(1);
  }
};

const main = async () => {
  GSOC_2026_ORGS = await obtenerOrgsGSoC2026();
  console.log(`Usando ${GSOC_2026_ORGS.length} orgs completas + ${GSOC_2026_REPOS_PUNTUALES.size} repos puntuales confirmados para detección GSoC 2026.`);
  await getGoodFirstIssues();
};

main();