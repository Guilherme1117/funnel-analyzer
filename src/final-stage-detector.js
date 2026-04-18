'use strict';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildStageLabel(stage) {
  return stage.name || stage.label || stage.code || 'UNKNOWN_STAGE';
}

function detectFinalStages(stageConfig) {
  const stages = Array.isArray(stageConfig?.stages) ? stageConfig.stages : [];
  if (stages.length === 0) return [];

  const explicitFinalStages = stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => stage?.is_final_stage === true)
    .map(({ stage, index }) => ({
      stage_code: stage.code,
      stage_label: buildStageLabel(stage),
      stage_index: index,
      reason: 'explicit_is_final_stage',
      score: 100
    }));

  if (explicitFinalStages.length > 0) return explicitFinalStages;

  const threshold = 5;
  const detected = [];

  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index];
    const total = stages.length;
    const normalized = normalize([
      stage.code,
      stage.name,
      stage.label,
      stage.id,
      ...(Array.isArray(stage.keywords) ? stage.keywords : [])
    ].join(' '));

    let score = 0;
    const reasons = [];

    if (index >= total - 2) {
      score += 2;
      reasons.push('tail_position');
    } else if (index === total - 3) {
      score += 1;
      reasons.push('late_position');
    }

    if (index === total - 1) {
      score += 2;
      reasons.push('last_stage');
    }

    if (/(agend|agenda|horario|schedule|appointment|booking|book|consulta marcada|marcad)/.test(normalized)) {
      score += 4;
      reasons.push('appointment_semantics');
    }

    if (/(confirm|confirmacao|confirmado|confirmed|confirmar)/.test(normalized)) {
      score += 3;
      reasons.push('confirmation_semantics');
    }

    if (/(captur|cadastro|lead|contato|fech|fechamento|closing|conversao|convert|pagamento|payment|checkout|compra|venda|conclu|finaliz|sucesso)/.test(normalized)) {
      score += 2;
      reasons.push('closure_semantics');
    }

    if (/(saudacao|boas vindas|abertura|inicio|entrada|primeiro contato|queixa|dor|triagem|qualific|diagnost|procedimento|interesse|objec|objecao|negociacao)/.test(normalized)) {
      score -= 4;
      reasons.push('early_stage_semantics');
    }

    if (score >= threshold) {
      detected.push({
        stage_code: stage.code,
        stage_label: buildStageLabel(stage),
        stage_index: index,
        reason: reasons.join('|') || 'semantic_and_order_match',
        score
      });
    }
  }

  if (detected.length > 0) return detected;

  const fallbackIndex = stages.length - 1;
  const fallbackStage = stages[fallbackIndex];
  return [{
    stage_code: fallbackStage.code,
    stage_label: buildStageLabel(fallbackStage),
    stage_index: fallbackIndex,
    reason: 'fallback_last_stage',
    score: 0
  }];
}

module.exports = { detectFinalStages };
