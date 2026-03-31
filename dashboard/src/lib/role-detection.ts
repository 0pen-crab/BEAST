// ── Role detection from file extension stats ──────────────────────────
//
// Scores file extensions into role buckets, then picks the dominant role.
// If both frontend and backend are significant → fullstack.

type RoleName =
  | 'Frontend Engineer'
  | 'Backend Engineer'
  | 'Fullstack Engineer'
  | 'DevOps Engineer'
  | 'Mobile Engineer'
  | 'Data Engineer'
  | 'ML Engineer'
  | 'Systems Engineer'
  | 'Game Developer'
  | 'QA Engineer'
  | 'Tech Writer'
  | 'Security Engineer'
  | 'Unknown';

export interface RoleResult {
  role: RoleName;
  confidence: number;
  topRoles: { role: RoleName; score: number }[];
}

// Weight map: extension → { role: weight }
// Higher weight = stronger signal for that role
const EXT_ROLES: Record<string, Partial<Record<RoleName, number>>> = {
  // ── Frontend ──────────────────────────
  '.tsx':        { 'Frontend Engineer': 3 },
  '.jsx':        { 'Frontend Engineer': 3 },
  '.css':        { 'Frontend Engineer': 2 },
  '.scss':       { 'Frontend Engineer': 2 },
  '.sass':       { 'Frontend Engineer': 2 },
  '.less':       { 'Frontend Engineer': 2 },
  '.styl':       { 'Frontend Engineer': 2 },
  '.postcss':    { 'Frontend Engineer': 2 },
  '.html':       { 'Frontend Engineer': 2 },
  '.vue':        { 'Frontend Engineer': 3 },
  '.svelte':     { 'Frontend Engineer': 3 },
  '.astro':      { 'Frontend Engineer': 3 },
  '.ejs':        { 'Frontend Engineer': 1.5 },
  '.hbs':        { 'Frontend Engineer': 1.5 },
  '.handlebars': { 'Frontend Engineer': 1.5 },
  '.pug':        { 'Frontend Engineer': 1.5 },
  '.njk':        { 'Frontend Engineer': 1.5 },
  '.svg':        { 'Frontend Engineer': 1 },
  '.woff':       { 'Frontend Engineer': 1 },
  '.woff2':      { 'Frontend Engineer': 1 },
  '.ttf':        { 'Frontend Engineer': 1 },
  '.eot':        { 'Frontend Engineer': 1 },

  // ── Backend ───────────────────────────
  '.go':         { 'Backend Engineer': 3 },
  '.rs':         { 'Backend Engineer': 3 },
  '.java':       { 'Backend Engineer': 3 },
  '.kt':         { 'Backend Engineer': 2, 'Mobile Engineer': 1.5 },
  '.kts':        { 'Backend Engineer': 2 },
  '.scala':      { 'Backend Engineer': 3 },
  '.clj':        { 'Backend Engineer': 3 },
  '.cljs':       { 'Frontend Engineer': 2, 'Backend Engineer': 1 },
  '.ex':         { 'Backend Engineer': 3 },
  '.exs':        { 'Backend Engineer': 3 },
  '.rb':         { 'Backend Engineer': 3 },
  '.erb':        { 'Backend Engineer': 2, 'Frontend Engineer': 1 },
  '.php':        { 'Backend Engineer': 3 },
  '.blade.php':  { 'Backend Engineer': 2, 'Frontend Engineer': 1 },
  '.cs':         { 'Backend Engineer': 2, 'Game Developer': 1.5 },
  '.fs':         { 'Backend Engineer': 3 },
  '.vb':         { 'Backend Engineer': 2 },
  '.erl':        { 'Backend Engineer': 3 },
  '.hs':         { 'Backend Engineer': 3 },
  '.lua':        { 'Backend Engineer': 1.5, 'Game Developer': 1.5 },
  '.pl':         { 'Backend Engineer': 2 },
  '.pm':         { 'Backend Engineer': 2 },
  '.r':          { 'Data Engineer': 2, 'ML Engineer': 1 },
  '.jl':         { 'ML Engineer': 2, 'Data Engineer': 1 },
  '.groovy':     { 'Backend Engineer': 2, 'DevOps Engineer': 1 },
  '.gradle':     { 'Backend Engineer': 1, 'DevOps Engineer': 1 },

  // ── Ambiguous (frontend + backend) ────
  '.ts':         { 'Frontend Engineer': 1, 'Backend Engineer': 1 },
  '.js':         { 'Frontend Engineer': 1, 'Backend Engineer': 1 },
  '.mjs':        { 'Backend Engineer': 1.5 },
  '.cjs':        { 'Backend Engineer': 1.5 },
  '.json':       { 'Frontend Engineer': 0.3, 'Backend Engineer': 0.3, 'DevOps Engineer': 0.3 },
  '.xml':        { 'Backend Engineer': 0.5, 'DevOps Engineer': 0.3 },

  // ── Python (ambiguous: backend / data / ML) ──
  '.py':         { 'Backend Engineer': 1, 'Data Engineer': 0.5, 'ML Engineer': 0.5 },
  '.pyx':        { 'Backend Engineer': 1.5, 'ML Engineer': 1 },
  '.pyi':        { 'Backend Engineer': 1 },
  '.ipynb':      { 'ML Engineer': 3, 'Data Engineer': 1.5 },

  // ── DevOps / Infrastructure ───────────
  '.yml':        { 'DevOps Engineer': 2 },
  '.yaml':       { 'DevOps Engineer': 2 },
  '.tf':         { 'DevOps Engineer': 3 },
  '.tfvars':     { 'DevOps Engineer': 3 },
  '.hcl':        { 'DevOps Engineer': 3 },
  '.dockerfile': { 'DevOps Engineer': 3 },
  '.dockerignore': { 'DevOps Engineer': 1 },
  '.sh':         { 'DevOps Engineer': 2 },
  '.bash':       { 'DevOps Engineer': 2 },
  '.zsh':        { 'DevOps Engineer': 2 },
  '.fish':       { 'DevOps Engineer': 2 },
  '.ps1':        { 'DevOps Engineer': 2 },
  '.psm1':       { 'DevOps Engineer': 2 },
  '.nix':        { 'DevOps Engineer': 3 },
  '.conf':       { 'DevOps Engineer': 1.5 },
  '.ini':        { 'DevOps Engineer': 1 },
  '.env':        { 'DevOps Engineer': 1 },
  '.toml':       { 'DevOps Engineer': 1, 'Backend Engineer': 0.5 },
  '.cfg':        { 'DevOps Engineer': 1 },
  '.helmignore': { 'DevOps Engineer': 2 },
  '.j2':         { 'DevOps Engineer': 2 },
  '.jinja':      { 'DevOps Engineer': 2 },
  '.jinja2':     { 'DevOps Engineer': 2 },
  '.vagrantfile':{ 'DevOps Engineer': 3 },
  '.pkr.hcl':   { 'DevOps Engineer': 3 },
  '.ansible':    { 'DevOps Engineer': 3 },

  // ── Mobile ────────────────────────────
  '.swift':      { 'Mobile Engineer': 3 },
  '.m':          { 'Mobile Engineer': 2 },
  '.mm':         { 'Mobile Engineer': 2 },
  '.xib':        { 'Mobile Engineer': 2 },
  '.storyboard': { 'Mobile Engineer': 2 },
  '.pbxproj':    { 'Mobile Engineer': 1.5 },
  '.plist':      { 'Mobile Engineer': 1.5 },
  '.dart':       { 'Mobile Engineer': 3 },
  '.xcconfig':   { 'Mobile Engineer': 1.5 },
  '.entitlements': { 'Mobile Engineer': 1.5 },

  // ── Data Engineering ──────────────────
  '.sql':        { 'Data Engineer': 2, 'Backend Engineer': 1 },
  '.prisma':     { 'Backend Engineer': 2 },
  '.graphql':    { 'Backend Engineer': 1.5, 'Frontend Engineer': 0.5 },
  '.gql':        { 'Backend Engineer': 1.5, 'Frontend Engineer': 0.5 },
  '.csv':        { 'Data Engineer': 1.5 },
  '.tsv':        { 'Data Engineer': 1.5 },
  '.parquet':    { 'Data Engineer': 2 },
  '.avro':       { 'Data Engineer': 2 },
  '.arrow':      { 'Data Engineer': 2 },
  '.dbt':        { 'Data Engineer': 3 },

  // ── ML / AI ───────────────────────────
  '.onnx':       { 'ML Engineer': 3 },
  '.h5':         { 'ML Engineer': 3 },
  '.pkl':        { 'ML Engineer': 2 },
  '.pt':         { 'ML Engineer': 3 },
  '.pth':        { 'ML Engineer': 3 },
  '.safetensors':{ 'ML Engineer': 3 },
  '.gguf':       { 'ML Engineer': 3 },

  // ── Systems / Embedded ────────────────
  '.c':          { 'Systems Engineer': 3 },
  '.h':          { 'Systems Engineer': 2 },
  '.cpp':        { 'Systems Engineer': 2.5, 'Game Developer': 1 },
  '.hpp':        { 'Systems Engineer': 2.5 },
  '.cc':         { 'Systems Engineer': 2.5 },
  '.hh':         { 'Systems Engineer': 2.5 },
  '.asm':        { 'Systems Engineer': 3 },
  '.s':          { 'Systems Engineer': 3 },
  '.ld':         { 'Systems Engineer': 3 },
  '.zig':        { 'Systems Engineer': 3 },
  '.v':          { 'Systems Engineer': 3 },
  '.sv':         { 'Systems Engineer': 3 },
  '.vhd':        { 'Systems Engineer': 3 },
  '.vhdl':       { 'Systems Engineer': 3 },
  '.cmake':      { 'Systems Engineer': 1.5 },
  '.makefile':   { 'Systems Engineer': 1.5, 'DevOps Engineer': 0.5 },

  // ── Game Development ──────────────────
  '.unity':      { 'Game Developer': 3 },
  '.shader':     { 'Game Developer': 3 },
  '.hlsl':       { 'Game Developer': 3 },
  '.glsl':       { 'Game Developer': 3 },
  '.gdscript':   { 'Game Developer': 3 },
  '.gd':         { 'Game Developer': 3 },
  '.tscn':       { 'Game Developer': 3 },
  '.tres':       { 'Game Developer': 2 },
  '.uasset':     { 'Game Developer': 3 },
  '.uplugin':    { 'Game Developer': 3 },
  '.uproject':   { 'Game Developer': 3 },
  '.material':   { 'Game Developer': 2 },
  '.fbx':        { 'Game Developer': 2 },
  '.blend':      { 'Game Developer': 2 },

  // ── QA / Testing ──────────────────────
  '.feature':    { 'QA Engineer': 3 },
  '.robot':      { 'QA Engineer': 3 },
  '.spec.ts':    { 'QA Engineer': 2 },
  '.spec.js':    { 'QA Engineer': 2 },
  '.test.ts':    { 'QA Engineer': 2 },
  '.test.js':    { 'QA Engineer': 2 },
  '.spec.tsx':   { 'QA Engineer': 2 },
  '.test.tsx':   { 'QA Engineer': 2 },
  '.cy.ts':      { 'QA Engineer': 2 },
  '.cy.js':      { 'QA Engineer': 2 },
  '.e2e.ts':     { 'QA Engineer': 2 },
  '.stories.tsx': { 'Frontend Engineer': 1, 'QA Engineer': 1 },
  '.stories.ts': { 'Frontend Engineer': 1, 'QA Engineer': 1 },

  // ── Security ──────────────────────────
  '.pem':        { 'Security Engineer': 2 },
  '.crt':        { 'Security Engineer': 2 },
  '.key':        { 'Security Engineer': 2 },
  '.csr':        { 'Security Engineer': 2 },
  '.p12':        { 'Security Engineer': 2 },
  '.rego':       { 'Security Engineer': 3, 'DevOps Engineer': 1 },
  '.sentinel':   { 'Security Engineer': 2, 'DevOps Engineer': 1 },
  '.sarif':      { 'Security Engineer': 2 },

  // ── Documentation / Tech Writing ──────
  '.md':         { 'Tech Writer': 2 },
  '.mdx':        { 'Tech Writer': 2, 'Frontend Engineer': 0.5 },
  '.rst':        { 'Tech Writer': 2 },
  '.adoc':       { 'Tech Writer': 2 },
  '.tex':        { 'Tech Writer': 2 },
  '.txt':        { 'Tech Writer': 0.5 },
  '.wiki':       { 'Tech Writer': 2 },

  // ── Config / Build (low signal) ───────
  '.lock':       {},
  '.gitignore':  {},
  '.editorconfig': {},
  '.prettierrc': { 'Frontend Engineer': 0.3 },
  '.eslintrc':   { 'Frontend Engineer': 0.5 },
  '.babelrc':    { 'Frontend Engineer': 0.5 },
  '.htaccess':   { 'Backend Engineer': 1, 'DevOps Engineer': 0.5 },
  '.nginx':      { 'DevOps Engineer': 2 },
  '.apache':     { 'DevOps Engineer': 2 },
};

// File names (without extension) that signal specific roles
const FILENAME_ROLES: Record<string, Partial<Record<RoleName, number>>> = {
  'dockerfile':       { 'DevOps Engineer': 3 },
  'docker-compose':   { 'DevOps Engineer': 3 },
  'jenkinsfile':      { 'DevOps Engineer': 3 },
  'makefile':         { 'Systems Engineer': 1.5, 'DevOps Engineer': 0.5 },
  'cmakelists.txt':   { 'Systems Engineer': 2 },
  'package.json':     { 'Frontend Engineer': 0.5, 'Backend Engineer': 0.5 },
  'tsconfig.json':    { 'Frontend Engineer': 0.5, 'Backend Engineer': 0.5 },
  'webpack.config':   { 'Frontend Engineer': 2 },
  'vite.config':      { 'Frontend Engineer': 2 },
  'next.config':      { 'Frontend Engineer': 2 },
  'nuxt.config':      { 'Frontend Engineer': 2 },
  'tailwind.config':  { 'Frontend Engineer': 2 },
  'rollup.config':    { 'Frontend Engineer': 1.5 },
  '.github':          { 'DevOps Engineer': 1 },
  'terraform':        { 'DevOps Engineer': 2 },
  'helm':             { 'DevOps Engineer': 2 },
  'ansible':          { 'DevOps Engineer': 2 },
  'k8s':              { 'DevOps Engineer': 2 },
  'kubernetes':       { 'DevOps Engineer': 2 },
};

const ALL_ROLES: RoleName[] = [
  'Frontend Engineer', 'Backend Engineer', 'Fullstack Engineer', 'DevOps Engineer', 'Mobile Engineer',
  'Data Engineer', 'ML Engineer', 'Systems Engineer', 'Game Developer',
  'QA Engineer', 'Security Engineer', 'Tech Writer',
];

export function detectRole(fileTypes: Record<string, number>): RoleResult {
  const scores: Record<string, number> = {};
  for (const role of ALL_ROLES) scores[role] = 0;

  for (const [ext, fileCount] of Object.entries(fileTypes)) {
    const normalizedExt = ext.toLowerCase();

    // Try compound extensions first (e.g. .spec.ts, .test.tsx)
    let weights = EXT_ROLES[normalizedExt];

    // Try filename-based matching
    if (!weights) {
      for (const [pattern, w] of Object.entries(FILENAME_ROLES)) {
        if (normalizedExt.includes(pattern)) {
          weights = w;
          break;
        }
      }
    }

    if (!weights) continue;

    for (const [role, weight] of Object.entries(weights)) {
      scores[role] += fileCount * weight;
    }
  }

  // Build sorted role list (exclude Fullstack — computed separately)
  const topRoles = ALL_ROLES
    .filter(r => r !== 'Fullstack Engineer')
    .map(role => ({ role, score: scores[role] }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (topRoles.length === 0) {
    return { role: 'Unknown', confidence: 0, topRoles: [] };
  }

  const totalScore = topRoles.reduce((sum, r) => sum + r.score, 0);
  const frontendScore = scores['Frontend Engineer'] / totalScore;
  const backendScore = scores['Backend Engineer'] / totalScore;

  // Fullstack: both frontend and backend are significant (>30% each)
  if (frontendScore > 0.3 && backendScore > 0.3) {
    const fullstackScore = scores['Frontend Engineer'] + scores['Backend Engineer'];
    const confidence = fullstackScore / totalScore;
    return {
      role: 'Fullstack Engineer',
      confidence: Math.min(confidence, 1),
      topRoles: [{ role: 'Fullstack Engineer', score: fullstackScore }, ...topRoles],
    };
  }

  const winner = topRoles[0];
  const confidence = winner.score / totalScore;

  return {
    role: winner.role as RoleName,
    confidence: Math.min(confidence, 1),
    topRoles,
  };
}
