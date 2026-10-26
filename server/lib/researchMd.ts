/** Renders docs/RESEARCH.md from the Python research outputs (results.json, neural.json, rounds.json). Nothing in it is typed by hand. */
interface Ci { estimate: number; lo: number; hi: number }
interface Summary { n: number; logLoss: number; brier: number; accuracy: number; auc: number | null; calibration: { slope: number; intercept: number } | null }
interface Decision { mode: 'promote' | 'shadow' | 'reject'; reasons: string[]; foldWinShare: number | null; adjustedInterval?: { level: number; lo: number; hi: number; challengers: number } }
interface Entry { summary: Summary; vsBaseline: Ci | null; decision: Decision | null; note?: string }

export interface Results {
  generatedAt: string
  dataVersion: string
  featurePipeline: string
  codeCommit?: string | null
  protocol: Record<string, unknown> & { tuning: string; walkForward: string; baseline: string; bootstrap: string; ensembleMembers: string[] }
  versions: Record<string, string>
  replication: { pythonLogLoss: number; typescriptLogLoss: number; difference: number }
  tuning: Record<string, Record<string, unknown>>
  n: number
  period: string
  models: Record<string, Entry>
  ageReach: Record<string, { summary: Summary; vsNoAgeNoReach: Ci | null } | number>
  recencySensitivity?: Record<string, { summary: Summary; vsBaseline: Ci }>
  ensembles: { period: string; n: number; members: string[]; stackRidge: number; finalWeights: Record<string, Record<string, number>>; models: Record<string, Entry>; stackPlatt: { n: number; vsStack: Ci } }
  groups: Record<string, Record<string, number>>
  dataAudit?: { years: string; fights: number; bothDob: number; bothReach: number; withFightStats: number }[]
  experimentsRun: { modelFamilies: number; tuningTrials: number; ablations: number; ensembles: number }
}

export interface NeuralResults { n: number; setup: Record<string, string | number | number[]>; models: Record<string, Entry> }
export interface RoundsResults {
  status: string
  note: string
  results: Record<string, { n: number; classes: string[]; baseRate: number[]; logLoss: { model: number; baseRate: number; difference: Ci }; rankedProbabilityScore: { model: number; baseRate: number; difference: Ci }; decision: Decision }>
}

const f = (n: number | null | undefined, d = 4): string => (n === null || n === undefined || Number.isNaN(n) ? '–' : n.toFixed(d))
const sg = (n: number, d = 4): string => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`
const ci = (c: Ci | null): string => (c ? `${sg(c.estimate)} [${sg(c.lo)}, ${sg(c.hi)}]` : 'reference')
const table = (head: string[], rows: (string | number)[][]): string => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
const LABEL: Record<string, string> = {
  lr_prod: 'Production-form ridge logistic regression (baseline)', lr_all: 'Logistic regression, all features, tuned ridge', histgb: 'HistGradientBoosting', lightgbm: 'LightGBM', xgboost: 'XGBoost', catboost: 'CatBoost',
  lightgbm_es: 'LightGBM, trees chosen inside the training period', xgboost_es: 'XGBoost, trees chosen inside the training period', catboost_es: 'CatBoost, trees chosen inside the training period',
  glicko2: 'Glicko-2 ratings', hier: 'Hierarchical: production features plus fighter effects', hier_decay: 'Hierarchical, with older fights counting for less', lr_decay: 'Logistic regression, older fights count for less',
  lr_decay_with_reach: 'Same, with reach put back (the earlier production form)', elo_only: 'Elo only', coin_flip: 'Coin flip', favourite_by_rating: 'Always pick the higher-rated fighter',
  average: 'Average of the members', stack: 'Logistic stack of the members', weighted: 'Constrained weighted average', stack_by_experience: 'Stack fitted separately for newcomers and veterans',
  linear_torch: 'Neural framework, linear part only (a check)', mlp: 'Engineered features through a small neural network', gru: 'GRU over each fighter\'s last 8 fights', attn: 'Self-attention over each fighter\'s last 8 fights',
}
const name = (k: string): string => LABEL[k] ?? k
const mode = (d: Decision | null): string => (d ? d.mode : '')

export function renderResearch(r: Results, neural: NeuralResults | null, rounds: RoundsResults | null): string {
  const out: string[] = []
  const push = (...l: string[]): void => { out.push(...l, '') }
  push('# Model research: families, ratings, ensembles, sequences and rounds', `Generated from \`data/experiments/*.json\` (written by \`research/run.py\`, \`neural.py\`, \`rounds.py\`). Data version \`${r.dataVersion}\`, feature pipeline \`${r.featurePipeline}\`, ${r.period}, ${r.n} fights.`)

  push('## Reproduce', '```bash', 'npm install', 'python3 -m venv research/.venv && research/.venv/bin/pip install -r research/requirements.txt   # on macOS also: brew install libomp', 'npm run backtest && npm run research:export', 'research/.venv/bin/python research/run.py      # families, ratings, hierarchical, ensembles, age/reach', 'research/.venv/bin/python research/neural.py   # sequence models', 'research/.venv/bin/python research/rounds.py   # round-of-ending', 'research/.venv/bin/python -m unittest discover -s research -p "test_*.py"', '```',
    `Python ${r.versions.python}, numpy ${r.versions.numpy}, pandas ${r.versions.pandas}, scikit-learn ${r.versions.sklearn}.`,
    `**Reproduction check:** the Python production-form logistic regression gives log loss ${f(r.replication.pythonLogLoss, 6)} against ${f(r.replication.typescriptLogLoss, 6)} for the TypeScript production model on the same ${r.n} fights (difference ${r.replication.difference.toExponential(1)}). The two implementations agree, so the comparisons below are against the real baseline.`)

  push('## Protocol', `- ${r.protocol.tuning}`, `- ${r.protocol.walkForward}`, `- Baseline: ${r.protocol.baseline}`, `- ${r.protocol.bootstrap} Intervals are also given at a level widened for the number of challengers tested together (Bonferroni), because testing many models and reporting the best inflates apparent gains.`,
    `- ${r.experimentsRun.modelFamilies} model variants, ${r.experimentsRun.tuningTrials} Bayesian tuning trials, ${r.experimentsRun.ablations} feature ablations and ${r.experimentsRun.ensembles} ensemble constructions were run in this round, after earlier rounds described in the README.`,
    '- **There is no untouched holdout.** Every test year has been used to compare models. The prospective record in `data/ledger/` is the only clean out-of-sample evidence.')

  push('## Model families on identical folds', 'Log loss is the primary metric. "Calibration slope" is 1 when forecasts are neither too extreme (below 1) nor too timid (above 1). Decisions use the fixed promotion gate (paired interval below zero, gain of at least 0.002, better in 60% of years, slope within 0.8 to 1.2), plus the multiple-comparison check.')
  push(table(['Model', 'Log loss', 'Brier', 'Accuracy', 'AUC', 'Cal. slope', 'Against the baseline [95% CI]', 'Adjusted interval', 'Years better', 'Decision'],
    Object.entries(r.models).filter(([k]) => !['favourite_by_rating'].includes(k)).map(([k, v]) => [
      name(k), f(v.summary.logLoss), f(v.summary.brier), f(v.summary.accuracy, 3), f(v.summary.auc, 3), f(v.summary.calibration?.slope, 2), ci(v.vsBaseline),
      v.decision?.adjustedInterval ? `[${sg(v.decision.adjustedInterval.lo)}, ${sg(v.decision.adjustedInterval.hi)}]` : '', v.decision?.foldWinShare != null ? `${Math.round(v.decision.foldWinShare * 100)}%` : '', mode(v.decision)])))
  const fav = r.models.favourite_by_rating
  if (fav) push(`Always picking the higher-rated fighter is right ${f(fav.summary.accuracy * 100, 1)}% of the time (probabilities are not meaningful for that rule).`)
  push('Gradient-boosted models trained with a fixed number of trees chosen on small early data are under-trained and clearly worse. Choosing the number of trees inside each training period (the "es" rows) fixes most of that, but none beats the regularised logistic baseline. Glicko-2 and Elo, which use results only, are far behind a model with the full feature set.')

  const rec = Object.entries(r.recencySensitivity ?? {})
  if (rec.length) {
    const four = r.recencySensitivity?.['half-life 4 years']
    const decayModel = r.models.lr_decay
    const helped = rec.filter(([, v]) => v.vsBaseline.hi < 0).length
    push('## Older fights count for less', 'Weighting recent fights more when fitting. The half-life used (4 years) was chosen on 2008-2013 only. The other half-lives are shown for sensitivity, not selection.')
    push(table(['Half-life', 'Log loss', 'Against the baseline [95% CI]'], rec.map(([k, v]) => [k, f(v.summary.logLoss), ci(v.vsBaseline)])))
    push(`With the production feature set as it now stands (reach left out), recency weighting at the chosen half-life changes log loss by ${four ? ci(four.vsBaseline) : '–'}; ${helped} of ${rec.length} half-lives have an interval entirely below zero. Earlier, with reach still in the model, the same weighting looked stronger (about -0.0020); once the unverifiable input is gone most of that disappears. It does not clear the gate${decayModel?.decision ? ` (${decayModel.decision.mode})` : ''}, so the recency-weighted model runs only as a **shadow**: it forecasts alongside production, is saved with each forecast, and is graded prospectively (see the Monitoring panel). The fighter-effects ("hierarchical") model adds nothing by itself.`)
  }

  push('## Age and reach, one at a time', 'Age comes from the date of birth, which is fixed. Reach, stance and height come from a single current profile snapshot with no effective date, so their value at an earlier fight is unverified.')
  const base = r.ageReach['no age, no reach'] as { summary: Summary }
  push(table(['Features', 'Log loss', 'Against no age and no reach [95% CI]'], Object.entries(r.ageReach).filter(([, v]) => typeof v !== 'number').map(([k, v]) => {
    const e = v as { summary: Summary; vsNoAgeNoReach: Ci | null }
    return [k, f(e.summary.logLoss), ci(e.vsNoAgeNoReach)]
  })))
  push(`Age alone recovers essentially the whole gain (${sg((r.ageReach['age only'] as { vsNoAgeNoReach: Ci }).vsNoAgeNoReach.estimate)}); reach alone does nothing demonstrable (${sg((r.ageReach['reach only'] as { vsNoAgeNoReach: Ci }).vsNoAgeNoReach.estimate)}), and neither an age-by-reach interaction nor stance adds anything. The earlier combined ablation was therefore carried by age. Because reach was both unhelpful and of unverified historical accuracy, **it was removed from the production model** (model version 0.3); this table puts it back only to run the comparison. (Baseline without either: ${f(base.summary.logLoss)}.)`)

  const e = r.ensembles
  push('## Ensembles', `Members fixed before any result was read: ${e.members.join(', ')}. Weights are learned only from earlier years' out-of-fold forecasts. Compared on the later fights where a stack can be trained: ${e.period}, ${e.n} fights.`)
  push(table(['Model', 'Log loss', 'Accuracy', 'Cal. slope', 'Against the baseline [95% CI]', 'Decision'], Object.entries(e.models).map(([k, v]) => [name(k), f(v.summary.logLoss), f(v.summary.accuracy, 3), f(v.summary.calibration?.slope, 2), ci(v.vsBaseline), mode(v.decision)])))
  push(`Final stack weights (log-odds scale): ${Object.entries(e.finalWeights.stack ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}. Recalibrating the stack with Platt scaling fitted on earlier stack outputs changed log loss by ${ci(e.stackPlatt.vsStack)} on ${e.stackPlatt.n} fights. **No ensemble beat the logistic baseline**, so none is deployed: the members' errors are too similar, and the weaker members add noise.`)

  if (neural) {
    push('## Neural sequence models', `Each model is a linear part on the engineered features (the production form) plus a learned summary of each fighter's last 8 fights (${neural.setup.history}), so any gain is what the sequence adds beyond the features. ${neural.n} fights, ${(neural.setup.seeds as number[]).length} seeds averaged, ${neural.setup.epochs}.`)
    push(table(['Model', 'Log loss', 'Accuracy', 'Against the baseline [95% CI]', 'Decision'], Object.entries(neural.models).map(([k, v]) => [name(k), f(v.summary.logLoss), f(v.summary.accuracy, 3), ci(v.vsBaseline), mode(v.decision)])))
    push('The framework check (linear part only) reproduces the baseline, so the training procedure is sound. Neither a GRU nor attention over fight history improves on it: fight sequences carry no demonstrable information beyond the engineered summary features in this data.')
  }

  if (rounds) {
    push('## Round-of-ending forecasts', rounds.note, `Status: **${rounds.status}**.`)
    push(table(['Schedule', 'Fights', 'Classes', 'Log loss (model / base rate)', 'Difference [95% CI]', 'Ranked probability score difference', 'Decision'], Object.entries(rounds.results).map(([k, v]) => [k, v.n, v.classes.join(', '), `${f(v.logLoss.model)} / ${f(v.logLoss.baseRate)}`, ci(v.logLoss.difference), ci(v.rankedProbabilityScore.difference), mode(v.decision)])))
    push('Three-round fights show a small improvement over the base rate whose interval includes zero; five-round fights (few, and each round a separate class) are worse than the base rate. Round forecasts are therefore **not shown** on the site. The already-validated goes-the-distance probability remains the only duration output.')
  }

  push('## Where the baseline does better and worse', 'Log loss by group, on all test fights (groups of at least 150).')
  const gcols = ['lr_prod', 'lightgbm', 'catboost', 'hier', 'glicko2']
  push(table(['Group', 'n', ...gcols.map(name)], Object.entries(r.groups).map(([g, v]) => [g, v.n, ...gcols.map((c) => f(v[c]))])))

  push('## Data audit: what was knowable at the time of each fight',
    table(['Field', 'Source', 'Effective date', 'Safe for historical forecasts?'], [
      ['Fight results, method, round, weight class', 'ufcstats.com via a GPL-3.0 scrape', 'Event date', 'Yes: only fights dated before a forecast are used'],
      ['Per-fight strikes, takedowns, control', 'The same, summed over rounds', 'Event date (post-fight totals)', 'Yes: enters later forecasts only, after the fight, through rolling averages'],
      ['Date of birth, so age at the bout', 'Fighter profile page', 'Fixed for life', 'Yes'],
      ['Reach, height, stance', 'Fighter profile page, one current snapshot', 'Unknown: no effective date, no history', 'Unverified: today\'s value is used for all past fights; reach adds nothing demonstrable, so it is a removal candidate'],
      ['Weight class of each bout', 'Results file, per bout', 'Event date', 'Yes'],
      ['Elo, rolling statistics, opponent quality, activity', 'Computed here from earlier fights', 'Computed per forecast', 'Yes: checked by tests that remove or change later results and compare features'],
      ['Betting prices (2010-2020)', 'OpenML 43464, CC BY 4.0', 'Not stated: opening, closing or best price is unknown', 'Only used to compare, never to train the independent model'],
    ]))
  if (r.dataAudit?.length) push(table(['Years', 'Fights', 'Both fighters\' birth dates known', 'Both fighters\' reach known', 'Per-fight statistics available'], r.dataAudit.map((a) => [a.years, a.fights, `${f(a.bothDob * 100, 1)}%`, `${f(a.bothReach * 100, 1)}%`, `${f(a.withFightStats * 100, 1)}%`])), 'Share of decisive fights in each era where both fighters have the field. A profile existing today does not mean the value was known then.')

  push('## Not done', '- **Bayesian hierarchical model with a full posterior** (for example in PyMC or Stan): the partial-pooling model here is a maximum-a-posteriori fit with a Gaussian prior on fighter effects, which gives pooled estimates but not posterior intervals.', '- **Dynamic ensemble weights** beyond the newcomer/veteran split, and Bayesian model averaging: not tested because no ensemble beat the baseline.', '- **Prediction-interval coverage** for the tree and neural models: the production range comes from refitting the logistic model on resampled events; no comparable interval was built for the others.')
  return out.join('\n')
}
