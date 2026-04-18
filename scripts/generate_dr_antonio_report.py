import json
from datetime import datetime
from html import escape
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / "analise3_dr.txt"
HTML_OUTPUT = ROOT / "cache" / "relatorio_dr_antonio_v3.html"

TRACK_LABELS = {
    "pure_ia": "IA pura",
    "pure_human": "Humano puro",
    "hybrid": "Híbrida",
    "no_outbound": "Sem outbound",
}

TRACK_COLORS = {
    "pure_ia": "#1d9e75",
    "pure_human": "#a88b5b",
    "hybrid": "#3f85da",
    "no_outbound": "#d7d1c4",
}

STAGE_LABELS = {
    "SAUDACAO": "Saudação",
    "QUEIXA_PACIENTE": "Queixa do paciente",
    "VALIDACAO_QUEIXA": "Validação da queixa",
    "HISTORICO_TRATAMENTOS": "Histórico de tratamentos",
    "EXPLICACAO_FASTLIFTING": "Explicação Fastlifting",
    "EXPLICACAO_FULLFACE": "Explicação Full Face",
    "DIFERENCIAIS_TECNICA": "Diferenciais da técnica",
    "MEDO_RESULTADO": "Medo do resultado",
    "PERGUNTA_INVESTIMENTO": "Pergunta de investimento",
    "INVESTIMENTO_CONSULTA": "Investimento da consulta",
    "INVESTIMENTO_CIRURGIA_INFORMADO": "Investimento da cirurgia",
    "LOCALIZACAO": "Localização",
    "OFERTA_TELECONSULTA": "Oferta de teleconsulta",
    "HANDOFF": "Handoff",
    "CONTATO_EQUIPE": "Contato com equipe",
}

STAGE_SHORT = {
    "SAUDACAO": "SAUDAÇÃO",
    "QUEIXA_PACIENTE": "QUEIXA PAC.",
    "VALIDACAO_QUEIXA": "VALIDAÇÃO",
    "HISTORICO_TRATAMENTOS": "HISTÓRICO",
    "EXPLICACAO_FASTLIFTING": "FASTLIFTING",
    "EXPLICACAO_FULLFACE": "FULL FACE",
    "DIFERENCIAIS_TECNICA": "DIFERENCIAIS",
    "MEDO_RESULTADO": "MEDO",
    "PERGUNTA_INVESTIMENTO": "PERG. INVEST.",
    "INVESTIMENTO_CONSULTA": "INV. CONSULTA",
    "INVESTIMENTO_CIRURGIA_INFORMADO": "INV. CIRURGIA",
    "LOCALIZACAO": "LOCALIZAÇÃO",
    "OFERTA_TELECONSULTA": "TELECONSULTA",
    "HANDOFF": "HANDOFF",
    "CONTATO_EQUIPE": "CONTATO EQUIPE",
}

FINAL_REASON_LABELS = {
    "explicit_is_final_stage": "Marcado como etapa final na configuração.",
}

MONTHS_PT = {
    1: "janeiro",
    2: "fevereiro",
    3: "março",
    4: "abril",
    5: "maio",
    6: "junho",
    7: "julho",
    8: "agosto",
    9: "setembro",
    10: "outubro",
    11: "novembro",
    12: "dezembro",
}


def pct(value):
    return f"{value:.1f}%"


def short_account(account_id):
    return account_id.split("-")[0]


def short_run(run_id):
    return run_id.split("-")[0]


def parse_iso(date_text):
    return datetime.fromisoformat(date_text.replace("Z", "+00:00"))


def format_period(meta):
    start = parse_iso(meta["period"]["start"])
    end = parse_iso(meta["period"]["end"])
    return f"{start.day} - {end.day} de {MONTHS_PT[end.month]} de {end.year}"


def format_day(date_text):
    date = datetime.strptime(date_text, "%Y-%m-%d")
    return date.strftime("%d/%m")


def stage_label(code):
    return STAGE_LABELS.get(code, code.replace("_", " ").title())


def stage_short(code):
    return STAGE_SHORT.get(code, code.replace("_", " "))


def html_text(value):
    return escape(str(value))


def sequence_label(sequence):
    return " › ".join(stage_short(part) for part in sequence.split(">"))


def find_stage(stages, code):
    for stage in stages:
        if stage["code"] == code:
            return stage
    raise KeyError(code)


def best_final_track(final_by_track):
    best = None
    for final_stage in final_by_track:
        for track_key, track in final_stage["tracks"].items():
            candidate = {
                "stage": final_stage["stage_code"],
                "track": track_key,
                "conversion_pct": track["conversion_pct"],
                "converted": track["converted_conversations"],
            }
            if best is None or candidate["conversion_pct"] > best["conversion_pct"]:
                best = candidate
    return best


def peak_day(daily_track_volume):
    best = None
    for row in daily_track_volume:
        total = row["pure_ia"] + row["pure_human"] + row["hybrid"]
        candidate = {"date": row["date"], "total": total, **row}
        if best is None or total > best["total"]:
            best = candidate
    return best


def build_kpi_card(title, value, subtitle, tone="default"):
    return f"""
    <div class="kpi-card">
      <div class="kpi-title">{html_text(title)}</div>
      <div class="kpi-value tone-{html_text(tone)}">{html_text(value)}</div>
      <div class="kpi-subtitle">{html_text(subtitle)}</div>
    </div>
    """


def build_funnel_rows(stages):
    rows = []
    for stage in stages:
        dominant_track = "green" if stage["by_ia"] >= stage["by_human"] else "blue"
        rows.append(
            f"""
            <div class="stage-row">
              <div class="stage-row-head">
                <span class="stage-name">{html_text(stage_label(stage["code"]))}</span>
                <span class="stage-metric">{stage["reach"]} · {pct(stage["reach_pct"])}</span>
              </div>
              <div class="stage-bar">
                <div class="stage-fill tone-{dominant_track}" style="width:{stage['reach_pct']:.1f}%"></div>
              </div>
            </div>
            """
        )
    return "".join(rows)


def build_track_distribution(tracks, total):
    pure_ia_pct = tracks["pure_ia"]["count"] / total * 100
    hybrid_pct = tracks["hybrid"]["count"] / total * 100
    pure_human_pct = tracks["pure_human"]["count"] / total * 100
    cut_1 = pure_ia_pct * 3.6
    cut_2 = (pure_ia_pct + hybrid_pct) * 3.6
    legend = []
    for key in ["pure_ia", "hybrid", "pure_human"]:
        count = tracks[key]["count"]
        legend.append(
            f"""
            <div class="legend-row">
              <div class="legend-left">
                <span class="legend-dot" style="background:{TRACK_COLORS[key]}"></span>
                <span>{html_text(TRACK_LABELS[key])}</span>
              </div>
              <div class="legend-right">{count} <span>{pct(count / total * 100)}</span></div>
            </div>
            """
        )
    return f"""
    <div class="track-panel">
      <div class="donut" style="background:conic-gradient({TRACK_COLORS['pure_ia']} 0deg {cut_1:.1f}deg, {TRACK_COLORS['hybrid']} {cut_1:.1f}deg {cut_2:.1f}deg, {TRACK_COLORS['pure_human']} {cut_2:.1f}deg 360deg);">
        <div class="donut-center">
          <strong>{total}</strong>
          <span>leads</span>
        </div>
      </div>
      <div class="legend">
        {''.join(legend)}
      </div>
    </div>
    """


def build_conversion_rows(conversions):
    rows = []
    for index, item in enumerate(conversions):
        tone = "green" if index < 2 else "blue"
        rows.append(
            f"""
            <div class="list-row">
              <div class="list-path">
                <span>{html_text(stage_short(item['from']))}</span>
                <span class="arrow">→</span>
                <strong>{html_text(stage_short(item['to']))}</strong>
              </div>
              <div class="pill tone-{tone}">{pct(item['rate_pct'])}</div>
            </div>
            """
        )
    return "".join(rows)


def build_sequence_rows(sequences):
    rows = []
    for item in sequences:
        label = "TOP" if item["count"] >= 3 else "RECORRENTE"
        tone = "mint" if item["count"] >= 3 else "amber"
        rows.append(
            f"""
            <div class="list-row">
              <div class="sequence-left">
                <strong>{item['count']}x</strong>
                <span>{html_text(sequence_label(item['sequence']))}</span>
              </div>
              <div class="tag tag-{tone}">{label}</div>
            </div>
            """
        )
    return "".join(rows)


def build_final_stage_cards(final_stages):
    cards = []
    for item in final_stages:
        cards.append(
            f"""
            <div class="final-card">
              <div class="final-card-head">
                <h3>{html_text(stage_label(item['stage_code']))}</h3>
                <span class="score-badge">score {item['score']}</span>
              </div>
              <div class="final-card-main">{item['converted_count']} leads convertidos</div>
              <div class="final-card-note">Etapa {item['stage_index'] + 1} · {html_text(FINAL_REASON_LABELS.get(item['reason'], item['reason']))}</div>
            </div>
            """
        )
    return "".join(cards)


def build_final_track_tables(final_by_track):
    blocks = []
    for item in final_by_track:
        rows = []
        for track_key in ["pure_ia", "pure_human", "hybrid"]:
            track = item["tracks"][track_key]
            rows.append(
                f"""
                <div class="track-metric-row">
                  <div class="track-metric-head">
                    <span>{html_text(TRACK_LABELS[track_key])}</span>
                    <strong>{track['converted_conversations']}/{track['total_conversations']} · {pct(track['conversion_pct'])}</strong>
                  </div>
                  <div class="track-meter">
                    <div class="track-meter-fill" style="width:{track['conversion_pct']:.1f}%; background:{TRACK_COLORS[track_key]};"></div>
                  </div>
                </div>
                """
            )
        blocks.append(
            f"""
            <div class="section-card">
              <div class="section-title">Conversão para {html_text(stage_label(item['stage_code']))}</div>
              <div class="track-metrics">
                {''.join(rows)}
              </div>
            </div>
            """
        )
    return "".join(blocks)


def build_daily_volume_chart(daily_track_volume):
    max_value = max(
        max(row["pure_ia"], row["pure_human"], row["hybrid"])
        for row in daily_track_volume
    ) or 1
    columns = []
    total_chips = []
    for row in daily_track_volume:
        total = row["pure_ia"] + row["pure_human"] + row["hybrid"]
        columns.append(
            f"""
            <div class="day-col">
              <div class="day-bars">
                <span class="bar ia" style="height:{row['pure_ia'] / max_value * 120:.1f}px"></span>
                <span class="bar human" style="height:{row['pure_human'] / max_value * 120:.1f}px"></span>
                <span class="bar hybrid" style="height:{row['hybrid'] / max_value * 120:.1f}px"></span>
              </div>
              <div class="day-label">{format_day(row['date'])}</div>
            </div>
            """
        )
        total_chips.append(
            f"""
            <div class="total-chip">
              <span>{format_day(row['date'])}</span>
              <strong>{total}</strong>
            </div>
            """
        )
    return f"""
    <div class="section-card">
      <div class="section-title">Volume diário por trilha</div>
      <div class="daily-wrap">
        <div class="daily-legend">
          <span><i class="legend-dot" style="background:{TRACK_COLORS['pure_ia']}"></i>IA pura</span>
          <span><i class="legend-dot" style="background:{TRACK_COLORS['pure_human']}"></i>Humano puro</span>
          <span><i class="legend-dot" style="background:{TRACK_COLORS['hybrid']}"></i>Híbrida</span>
        </div>
        <div class="daily-chart">{''.join(columns)}</div>
        <div class="total-strip">{''.join(total_chips)}</div>
      </div>
    </div>
    """


def build_html(data):
    meta = data["meta"]
    funnel = data["funnel"]
    stages = funnel["stages"]
    tracks = funnel["tracks"]
    top_conversions = sorted(funnel["conversion"], key=lambda item: item["rate_pct"], reverse=True)[:7]
    top_sequences = funnel["top_sequences"][:7]
    final_stages = funnel["final_stages_detected"]
    final_by_track = funnel["final_stage_conversion_by_track"]
    daily_track_volume = funnel["daily_track_volume"]
    final_stage_map = {item["stage_code"]: item for item in final_by_track}

    total_professional = meta["professional"]
    total_chats = meta["total_chats"]
    period_label = format_period(meta)
    fastlifting_stage = find_stage(stages, "EXPLICACAO_FASTLIFTING")
    anomalies = funnel["anomalies"]["out_of_order_count"]
    pure_ia = tracks["pure_ia"]["count"]
    best_track = best_final_track(final_by_track)
    peak = peak_day(daily_track_volume)
    handoff_best = best_final_track([final_stage_map["HANDOFF"]])
    contact_best = best_final_track([final_stage_map["CONTATO_EQUIPE"]])

    anomaly_note = (
        f"{anomalies} fluxos ficaram fora da sequência esperada. "
        f"A entrada direta pela queixa segue dominante em {pct(find_stage(stages, 'QUEIXA_PACIENTE')['reach_pct'])}, "
        "o que exige um funil capaz de lidar com múltiplos pontos de entrada sem perder contexto."
    )
    opportunity_note = (
        f"{stage_label(best_track['stage'])} tem sua melhor taxa final na trilha {TRACK_LABELS[best_track['track']].lower()} "
        f"({pct(best_track['conversion_pct'])}). "
        f"Há espaço claro para ampliar esse fechamento a partir das etapas com maior volume, principalmente Fastlifting e Histórico."
    )
    peak_note = (
        f"O maior volume diário ocorreu em {format_day(peak['date'])}, com {peak['total']} leads. "
        f"A trilha híbrida puxou o pico com {peak['hybrid']} atendimentos."
    )
    handoff_note = (
        f"Handoff aparece como etapa final detectada, mas só converte na trilha {TRACK_LABELS[handoff_best['track']].lower()} "
        f"({handoff_best['converted']} leads, {pct(handoff_best['conversion_pct'])})."
    )
    contact_note = (
        f"Contato com equipe concentrou conversão apenas na trilha {TRACK_LABELS[contact_best['track']].lower()}, "
        f"com {contact_best['converted']} leads e {pct(contact_best['conversion_pct'])}."
    )

    summary_cards_page_2 = "".join(
        [
            build_kpi_card(
                "ESTÁGIOS FINAIS",
                str(len(final_stages)),
                f"{sum(item['converted_count'] for item in final_stages)} conversões finais mapeadas",
            ),
            build_kpi_card(
                "MELHOR FECHAMENTO FINAL",
                pct(best_track["conversion_pct"]),
                f"{TRACK_LABELS[best_track['track']]} → {stage_label(best_track['stage'])}",
                tone="green",
            ),
            build_kpi_card(
                "PICO DIÁRIO",
                str(peak["total"]),
                f"{format_day(peak['date'])} · IA {peak['pure_ia']} · Humano {peak['pure_human']} · Híbrida {peak['hybrid']}",
                tone="blue",
            ),
        ]
    )

    generated_at = parse_iso(meta["analyzed_at"]).strftime("%d/%m/%Y")

    footer = f"""
    <div class="footer">
      <span>LeãoCorp Analytics · gerado em {generated_at}</span>
      <span>account {short_account(meta['account_id'])} · run {short_run(data['run_id'])}</span>
    </div>
    """

    return f"""<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Relatório Dr. Antônio v3</title>
  <style>
    @page {{
      size: A4;
      margin: 0;
    }}
    :root {{
      --paper: #f6f2e8;
      --paper-2: #fbf8f1;
      --ink: #2c2c2a;
      --muted: #88877f;
      --line: #d3cfc2;
      --green: #1d9e75;
      --green-soft: #e1f5ed;
      --blue: #3f85da;
      --blue-soft: #e6f0fd;
      --amber: #ba7517;
      --amber-soft: #f9eed8;
      --taupe: #a88b5b;
      --mint-soft: #e1f5ed;
      --font: "Segoe UI", Arial, sans-serif;
    }}
    * {{
      box-sizing: border-box;
    }}
    body {{
      margin: 0;
      background: #ded9cd;
      color: var(--ink);
      font-family: var(--font);
    }}
    .page {{
      width: 210mm;
      height: 297mm;
      padding: 15mm 16mm 12mm;
      background:
        radial-gradient(circle at top right, rgba(29, 158, 117, 0.08), transparent 35%),
        linear-gradient(180deg, #fcfaf4 0%, var(--paper) 100%);
      position: relative;
      page-break-after: always;
      overflow: hidden;
    }}
    .page:last-child {{
      page-break-after: auto;
    }}
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
    }}
    .eyebrow {{
      color: var(--muted);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }}
    h1 {{
      margin: 0;
      font-size: 25px;
      line-height: 1.1;
      font-weight: 700;
    }}
    .period {{
      text-align: right;
    }}
    .period strong {{
      display: block;
      font-size: 14px;
      margin-top: 6px;
    }}
    .subtitle {{
      margin-top: 6px;
      color: var(--muted);
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }}
    .kpi-grid {{
      margin-top: 12px;
      display: grid;
      grid-template-columns: 1.15fr 1fr 0.92fr 0.92fr;
      gap: 8px;
    }}
    .kpi-card {{
      background: rgba(255,255,255,0.48);
      border: 1px solid rgba(168, 139, 91, 0.16);
      border-radius: 14px;
      padding: 10px 12px;
      min-height: 92px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 10px 30px rgba(64, 52, 31, 0.05);
    }}
    .kpi-title {{
      color: var(--muted);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 600;
    }}
    .kpi-value {{
      font-size: 29px;
      font-weight: 700;
      line-height: 1;
      margin: 8px 0 4px;
    }}
    .kpi-subtitle {{
      font-size: 10px;
      line-height: 1.3;
      color: var(--muted);
    }}
    .tone-default {{
      color: var(--ink);
    }}
    .tone-green {{
      color: var(--green);
    }}
    .tone-blue {{
      color: var(--blue);
    }}
    .tone-amber {{
      color: var(--amber);
    }}
    .two-col {{
      display: grid;
      grid-template-columns: 1.2fr 0.9fr;
      gap: 10px;
      margin-top: 12px;
    }}
    .two-col.equal {{
      grid-template-columns: 1fr 1fr;
    }}
    .section-card {{
      background: rgba(255,255,255,0.54);
      border: 1px solid rgba(168, 139, 91, 0.14);
      border-radius: 16px;
      padding: 12px 14px 14px;
      box-shadow: 0 10px 30px rgba(64, 52, 31, 0.05);
    }}
    .section-title {{
      font-size: 14px;
      font-weight: 700;
      margin: 0 0 10px;
      padding-left: 10px;
      border-left: 4px solid var(--green);
    }}
    .stage-row {{
      margin-bottom: 7px;
    }}
    .stage-row:last-child {{
      margin-bottom: 0;
    }}
    .stage-row-head {{
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 3px;
      font-size: 11px;
    }}
    .stage-name {{
      color: var(--ink);
      font-weight: 600;
      min-width: 0;
    }}
    .stage-metric {{
      color: var(--muted);
      white-space: nowrap;
    }}
    .stage-bar {{
      height: 8px;
      background: #ece7dc;
      border-radius: 999px;
      overflow: hidden;
    }}
    .stage-fill {{
      height: 100%;
      border-radius: inherit;
    }}
    .track-panel {{
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 10px;
      align-items: start;
    }}
    .donut {{
      width: 112px;
      height: 112px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      margin: 0 auto;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04);
    }}
    .donut-center {{
      width: 68px;
      height: 68px;
      border-radius: 50%;
      background: var(--paper-2);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 10px rgba(255,255,255,0.7);
    }}
    .donut-center strong {{
      font-size: 22px;
      line-height: 1;
    }}
    .donut-center span {{
      margin-top: 2px;
      font-size: 11px;
      color: var(--muted);
    }}
    .legend {{
      display: grid;
      gap: 8px;
      font-size: 11px;
    }}
    .legend-row {{
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #ece7dc;
    }}
    .legend-left {{
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }}
    .legend-right {{
      color: var(--ink);
      font-weight: 700;
    }}
    .legend-right span {{
      color: var(--muted);
      font-weight: 500;
      margin-left: 4px;
    }}
    .legend-dot {{
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      flex: 0 0 auto;
    }}
    .list-row {{
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 0;
      border-bottom: 1px solid #ece7dc;
    }}
    .list-row:last-child {{
      border-bottom: 0;
      padding-bottom: 0;
    }}
    .list-path {{
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      min-width: 0;
    }}
    .list-path strong {{
      color: var(--ink);
    }}
    .arrow {{
      color: #b3ad9d;
      font-weight: 700;
    }}
    .pill {{
      min-width: 62px;
      text-align: center;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 700;
      color: #fff;
    }}
    .sequence-left {{
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 11px;
      min-width: 0;
    }}
    .sequence-left strong {{
      font-size: 20px;
      line-height: 1;
      min-width: 30px;
    }}
    .sequence-left span {{
      color: var(--muted);
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-height: 1.35;
    }}
    .tag {{
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      border-radius: 999px;
      padding: 6px 8px;
    }}
    .tag-mint {{
      background: var(--green-soft);
      color: #0b5e44;
    }}
    .tag-amber {{
      background: var(--amber-soft);
      color: #8a5610;
    }}
    .notes {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }}
    .note {{
      border-radius: 16px;
      padding: 12px 14px 12px 16px;
      position: relative;
      min-height: 0;
    }}
    .note::before {{
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 5px;
      border-radius: 16px 0 0 16px;
    }}
    .note h3 {{
      margin: 0 0 6px;
      font-size: 12px;
    }}
    .note p {{
      margin: 0;
      font-size: 11px;
      line-height: 1.4;
    }}
    .note-warning {{
      background: var(--amber-soft);
      color: #6b4510;
    }}
    .note-warning::before {{
      background: var(--amber);
    }}
    .note-success {{
      background: var(--green-soft);
      color: #134d39;
    }}
    .note-success::before {{
      background: var(--green);
    }}
    .footer {{
      position: absolute;
      left: 16mm;
      right: 16mm;
      bottom: 6mm;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding-top: 6px;
      border-top: 1px solid var(--line);
      color: #b1ab9c;
      font-size: 9px;
    }}
    .section-stack {{
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }}
    .page-compact .header {{
      padding-bottom: 6px;
    }}
    .page-compact h1 {{
      font-size: 22px;
    }}
    .page-compact .subtitle {{
      font-size: 9px;
      margin-top: 4px;
    }}
    .page-two .kpi-grid {{
      grid-template-columns: repeat(3, 1fr);
    }}
    .final-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }}
    .final-card {{
      background: rgba(255,255,255,0.48);
      border: 1px solid rgba(168, 139, 91, 0.16);
      border-radius: 14px;
      padding: 12px;
    }}
    .final-card-head {{
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }}
    .final-card-head h3 {{
      margin: 0;
      font-size: 14px;
    }}
    .score-badge {{
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #0b5e44;
      background: var(--green-soft);
      border-radius: 999px;
      padding: 5px 8px;
      font-weight: 700;
      white-space: nowrap;
    }}
    .final-card-main {{
      font-size: 22px;
      font-weight: 700;
      line-height: 1;
      margin-bottom: 6px;
    }}
    .final-card-note {{
      font-size: 11px;
      line-height: 1.4;
      color: var(--muted);
    }}
    .track-metrics {{
      display: grid;
      gap: 10px;
    }}
    .track-metric-row {{
      display: grid;
      gap: 5px;
    }}
    .track-metric-head {{
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
      align-items: baseline;
    }}
    .track-metric-head span {{
      color: var(--muted);
      font-weight: 600;
      min-width: 0;
    }}
    .track-metric-head strong {{
      white-space: nowrap;
      font-size: 11px;
    }}
    .track-meter {{
      height: 8px;
      background: #ece7dc;
      border-radius: 999px;
      overflow: hidden;
    }}
    .track-meter-fill {{
      height: 100%;
      border-radius: inherit;
    }}
    .daily-wrap {{
      display: grid;
      gap: 10px;
    }}
    .daily-legend {{
      display: flex;
      gap: 14px;
      font-size: 10px;
      color: var(--muted);
      font-weight: 600;
      flex-wrap: wrap;
    }}
    .daily-chart {{
      background: rgba(255,255,255,0.48);
      border: 1px solid rgba(168, 139, 91, 0.12);
      border-radius: 14px;
      padding: 12px 12px 8px;
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
      align-items: end;
      min-height: 148px;
    }}
    .day-col {{
      display: grid;
      justify-items: center;
      gap: 8px;
    }}
    .day-bars {{
      height: 96px;
      display: flex;
      align-items: end;
      gap: 3px;
    }}
    .bar {{
      width: 12px;
      border-radius: 8px 8px 0 0;
      display: inline-block;
    }}
    .bar.ia {{
      background: var(--green);
    }}
    .bar.human {{
      background: var(--taupe);
    }}
    .bar.hybrid {{
      background: var(--blue);
    }}
    .day-label {{
      font-size: 10px;
      color: var(--muted);
      font-weight: 600;
    }}
    .total-strip {{
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
    }}
    .total-chip {{
      background: rgba(255,255,255,0.58);
      border: 1px solid rgba(168, 139, 91, 0.12);
      border-radius: 12px;
      padding: 7px 8px;
      display: grid;
      gap: 3px;
      text-align: center;
    }}
    .total-chip span {{
      font-size: 9px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }}
    .total-chip strong {{
      font-size: 14px;
      font-weight: 700;
    }}
    .insight-row {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }}
    .closing-grid {{
      display: grid;
      grid-template-columns: 0.96fr 1.04fr;
      gap: 10px;
      margin-top: 12px;
      align-items: start;
    }}
    .stack {{
      display: grid;
      gap: 10px;
      align-content: start;
    }}
    .section-card.section-tight {{
      padding: 10px 12px 12px;
    }}
  </style>
</head>
  <body>
  <section class="page">
    <div class="header">
      <div>
        <div class="eyebrow">Análise de performance · IA + humano · Clínica Dr. Antônio</div>
        <h1>Relatório de Atendimentos</h1>
        <div class="subtitle">Funil de atendimento e conversões prioritárias</div>
      </div>
      <div class="period">
        <div class="eyebrow">Período analisado</div>
        <strong>{html_text(period_label)}</strong>
      </div>
    </div>

    <div class="kpi-grid">
      {build_kpi_card("ATENDIMENTOS PROFISSIONAIS", str(total_professional), f"de {total_chats} conversas totais")}
      {build_kpi_card("EXPL. FASTLIFTING", pct(fastlifting_stage["reach_pct"]), f"{fastlifting_stage['reach']} de {total_professional} chegaram à etapa", tone="green")}
      {build_kpi_card("ATENDIMENTOS PELA IA", pct(pure_ia / total_professional * 100), f"{pure_ia} leads tratados 100% por IA")}
      {build_kpi_card("FLUXOS FORA DE ORDEM", str(anomalies), "oportunidade de melhoria", tone="amber")}
    </div>

    <div class="two-col">
      <div class="section-card">
        <div class="section-title">Funil de atendimento · todas as etapas</div>
        {build_funnel_rows(stages)}
      </div>
      <div class="section-card">
        <div class="section-title">Distribuição por trilha</div>
        {build_track_distribution(tracks, total_professional)}
      </div>
    </div>

    {footer}
  </section>

  <section class="page page-compact">
    <div class="header">
      <div>
        <div class="eyebrow">Análise detalhada · Clínica Dr. Antônio</div>
        <h1>Conversões e padrões de jornada</h1>
        <div class="subtitle">Transições mais fortes, sequências recorrentes e leituras de otimização</div>
      </div>
      <div class="period">
        <div class="eyebrow">Período analisado</div>
        <strong>{html_text(period_label)}</strong>
      </div>
    </div>

    <div class="two-col" style="margin-top: 12px; grid-template-columns: 1.08fr 0.92fr;">
      <div class="section-card">
        <div class="section-title">Principais conversões</div>
        {build_conversion_rows(top_conversions)}
      </div>
      <div class="section-card">
        <div class="section-title">Sequências mais frequentes</div>
        {build_sequence_rows(top_sequences)}
      </div>
    </div>

    <div class="insight-row">
      <div class="note note-warning">
        <h3>Fluxos fora de sequência</h3>
        <p>{html_text(anomaly_note)}</p>
      </div>
      <div class="note note-success">
        <h3>Maior oportunidade de conversão</h3>
        <p>{html_text(opportunity_note)}</p>
      </div>
    </div>

    {footer}
  </section>

  <section class="page page-two page-compact">
    <div class="header">
      <div>
        <div class="eyebrow">Análise complementar · Clínica Dr. Antônio</div>
        <h1>Fechamento final e volume diário</h1>
        <div class="subtitle">Etapas finais detectadas, conversão por trilha e oscilação diária</div>
      </div>
      <div class="period">
        <div class="eyebrow">Período analisado</div>
        <strong>{html_text(period_label)}</strong>
      </div>
    </div>

    <div class="kpi-grid">
      {summary_cards_page_2}
    </div>

    <div class="closing-grid">
      <div class="stack">
        <div class="section-card section-tight">
          <div class="section-title">Estágios finais detectados</div>
          <div class="final-grid">
            {build_final_stage_cards(final_stages)}
          </div>
        </div>
        {build_final_track_tables(final_by_track)}
      </div>

      <div class="stack">
        {build_daily_volume_chart(daily_track_volume)}
        <div class="notes" style="margin-top: 0;">
          <div class="note note-success">
            <h3>Pico de volume</h3>
            <p>{html_text(peak_note)}</p>
          </div>
          <div class="note note-success">
            <h3>Fechamento em HANDOFF</h3>
            <p>{html_text(handoff_note)}</p>
          </div>
        </div>
        <div class="note note-warning">
          <h3>Contato com equipe</h3>
          <p>{html_text(contact_note)}</p>
        </div>
      </div>
    </div>

    {footer}
  </section>
</body>
</html>
"""


def main():
    data = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    HTML_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    HTML_OUTPUT.write_text(build_html(data), encoding="utf-8")
    print(HTML_OUTPUT)


if __name__ == "__main__":
    main()
