# =============================================================================
# GERADOR DE RELATÓRIO PDF — LeãoCorp Analytics
# =============================================================================
# Tecnologia: Python puro — NÃO é HTML/CSS/JS.
# O PDF é gerado em memória usando duas bibliotecas principais:
#
#   1. matplotlib  → desenha os gráficos (funil, donut, barras, jornadas)
#                    e exporta como PNG em buffer de memória
#   2. reportlab   → monta o layout da página A4 (tabelas, textos, imagens)
#                    e serializa tudo para .pdf
#
# O truque central: matplotlib gera os visuais → fig_to_img() os converte
# em PNG em memória (sem salvar em disco) → reportlab os embute como Image()
# dentro do layout de tabela da página.
#
# Instalação:
#   pip install reportlab matplotlib numpy
# =============================================================================

import io, math
import matplotlib
matplotlib.use('Agg')          # backend sem janela (necessário em servidor)
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle,
    Paragraph, Spacer, HRFlowable, Image, PageBreak
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT

# A4 em pontos: W=595, H=842
W, H = A4

# =============================================================================
# PALETA DE CORES
# =============================================================================
# Centralizar todas as cores num dict evita inconsistências e facilita
# trocar o tema inteiro mudando apenas este bloco.
# Os tons _bg/_dk/_md formam trios: fundo claro / texto escuro / texto médio
# — convenção de design system para garantir contraste acessível.
C = {
    'border':   colors.HexColor('#D3D1C7'),  # bordas sutis
    'text':     colors.HexColor('#2C2C2A'),  # texto principal
    'muted':    colors.HexColor('#888780'),  # texto secundário
    'light':    colors.HexColor('#F1EFE8'),  # fundo de cards KPI
    'white':    colors.HexColor('#FFFFFF'),
    'green':    colors.HexColor('#1D9E75'),  # cor primária (sucesso/conversão)
    'blue':     colors.HexColor('#378ADD'),  # cor secundária (info)
    'amber':    colors.HexColor('#BA7517'),  # alerta
    'red':      colors.HexColor('#D85A30'),  # crítico
    'green_bg': colors.HexColor('#E1F5EE'),
    'green_dk': colors.HexColor('#085041'),
    'green_md': colors.HexColor('#0F6E56'),
    'amber_bg': colors.HexColor('#FAEEDA'),
    'amber_dk': colors.HexColor('#633806'),
    'amber_md': colors.HexColor('#854F0B'),
    'blue_bg':  colors.HexColor('#E6F1FB'),
    'blue_dk':  colors.HexColor('#0C447C'),
    'blue_md':  colors.HexColor('#185FA5'),
}

# =============================================================================
# UTILITÁRIO: matplotlib → PNG em memória → reportlab Image
# =============================================================================
# Sem esse helper, cada gráfico precisaria ser salvo em disco.
# io.BytesIO cria um arquivo "virtual" na RAM — mais rápido e limpo.
def fig_to_img(fig, dpi=160):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight', transparent=True)
    buf.seek(0)
    plt.close(fig)   # libera memória do matplotlib
    return buf       # retorna buffer; reportlab lê com Image(buf, width=..., height=...)

# =============================================================================
# GRÁFICO 1 — FUNIL VERDADEIRO COM TRAPÉZIOS
# =============================================================================
# PROBLEMA ORIGINAL: barras horizontais independentes não comunicam "jornada".
# SOLUÇÃO: agrupar em 5 macro-fases e desenhar polígonos trapezoidais onde
# a largura de cada fase é proporcional à contagem de leads — o afunilamento
# visual é imediato e intuitivo.
#
# Cada tupla: (nome_fase, leads_contagem, percentual, subtítulo_etapas)
funnel_phases = [
    ("Contato Inicial",  54, 100.0, "Saudação + Queixa do paciente"),
    ("Qualificação",     33,  61.1, "Validação + Aprofundamento + Ponte"),
    ("Oferta",           31,  57.4, "Explicação GB + Convite Avaliação"),
    ("Coleta de Dados",  20,  37.0, "Intenção agendar + Coleta dados"),
    ("Conversão",        16,  29.6, "Handoff agendamento + Handoff e-book"),
]
# Gradiente verde→azul escuro: reforça a ideia de "profundidade" no funil
PHASE_COLORS = ['#1D9E75','#2BA87F','#378ADD','#5B9DD4','#0C447C']

def make_funnel_chart(w_in, h_in):
    fig, ax = plt.subplots(figsize=(w_in, h_in))
    fig.patch.set_alpha(0)        # fundo transparente — reportlab controla o bg
    ax.set_facecolor('none')
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.axis('off')                # sem eixos — a forma fala por si

    n     = len(funnel_phases)
    slot  = 1.0 / n               # altura de cada fase em coords normalizadas
    gap   = 0.018                 # espaço branco entre fases
    max_w = 0.82                  # largura máxima (fase topo = 100%)
    min_w = 0.26                  # largura mínima (evita que fundo some a zero)

    for i, (label, count, pct, sub) in enumerate(funnel_phases):
        # Calcular largura proporcional à contagem de leads
        frac  = count / funnel_phases[0][1]
        bar_w = min_w + (max_w - min_w) * frac
        x0    = (1 - bar_w) / 2          # centralizar horizontalmente
        y0    = 1 - (i + 1) * slot + gap / 2
        y1    = 1 - i * slot - gap / 2

        # Largura da PRÓXIMA fase para criar o efeito de trapézio
        # (base menor = fase seguinte mais estreita)
        if i < n - 1:
            frac_next  = funnel_phases[i+1][1] / funnel_phases[0][1]
            bar_w_next = min_w + (max_w - min_w) * frac_next
        else:
            bar_w_next = bar_w   # última fase: retângulo

        x0n = (1 - bar_w_next) / 2
        x1  = x0 + bar_w
        x1n = x0n + bar_w_next

        # Polígono trapezoidal: 4 pontos no sentido anti-horário
        # topo-esq, topo-dir, base-dir, base-esq  →  trapézio inclinado
        poly = plt.Polygon(
            list(zip([x0n, x1n, x1, x0], [y0, y0, y1, y1])),
            color=PHASE_COLORS[i], alpha=0.88, zorder=3
        )
        ax.add_patch(poly)

        # Linha branca de separação entre fases (efeito "camadas")
        ax.plot([x0n - 0.01, x1n + 0.01], [y0, y0],
                color='white', linewidth=1.2, zorder=4)

        # Textos centralizados dentro do trapézio (nome + subtítulo)
        cy = (y0 + y1) / 2
        ax.text(0.5, cy + 0.022, label,
                ha='center', va='center', fontsize=8, fontweight='bold',
                color='white', zorder=5)
        ax.text(0.5, cy - 0.022, sub,
                ha='center', va='center', fontsize=6, color='white',
                alpha=0.85, zorder=5)

        # Contagem + percentual à DIREITA do trapézio (fora, legível)
        ax.text(x1 + 0.025, cy + 0.016, f'{count}',
                ha='left', va='center', fontsize=8.5, fontweight='bold',
                color='#2C2C2A', zorder=5)
        ax.text(x1 + 0.025, cy - 0.016, f'{pct:.1f}%',
                ha='left', va='center', fontsize=7, color='#888780', zorder=5)

    fig.tight_layout(pad=0)
    return fig_to_img(fig)

# =============================================================================
# GRÁFICO 2 — DONUT DE DISTRIBUIÇÃO POR TRILHA
# =============================================================================
# "width" no wedgeprops cria o anel (donut) — valor < 1 deixa espaço central
# para o texto com o total de leads.
def make_donut_chart(sz):
    fig, ax = plt.subplots(figsize=(sz, sz))
    fig.patch.set_alpha(0); ax.set_facecolor('none')
    ax.pie([44, 10], colors=['#1D9E75','#378ADD'],
           startangle=90,
           wedgeprops={'width': 0.52, 'linewidth': 0})  # 0.52 = espessura do anel
    ax.text(0, 0, '54\nleads', ha='center', va='center',
            fontsize=10, color='#2C2C2A', fontweight='bold', linespacing=1.4)
    fig.tight_layout(pad=0.2)
    return fig_to_img(fig)

# =============================================================================
# GRÁFICO 3 — VOLUME DIÁRIO (BARRAS EMPILHADAS)
# =============================================================================
# Dados do campo NOVO "daily_track_volume" da análise.
# Barras empilhadas (stacked): a segunda série usa "bottom=daily_ia"
# para sobrepor na parte de cima das barras de IA pura.
daily_dates = ['13/04','14/04','15/04','16/04','17/04','18/04']
daily_ia    = [5, 7, 7, 7, 15, 7]   # pure_ia
daily_hyb   = [4, 1, 1, 0,  4, 0]   # hybrid

def make_daily_chart(w_in, h_in):
    x = np.arange(len(daily_dates))
    fig, ax = plt.subplots(figsize=(w_in, h_in))
    fig.patch.set_alpha(0); ax.set_facecolor('none')
    ax.bar(x, daily_ia,  color='#1D9E75', width=0.5, zorder=3)
    ax.bar(x, daily_hyb, bottom=daily_ia, color='#378ADD', width=0.5, zorder=3)
    # Total acima de cada barra
    for i, (ia, hy) in enumerate(zip(daily_ia, daily_hyb)):
        ax.text(i, ia+hy+0.3, str(ia+hy),
                ha='center', va='bottom', fontsize=7.5, color='#444441', fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels(daily_dates, fontsize=7.5, color='#444441')
    ax.tick_params(axis='y', labelsize=6.5, colors='#aaa9a2', length=0)
    ax.tick_params(axis='x', length=0)
    ax.set_ylim(0, 23)
    ax.yaxis.grid(True, color='#e0ddd6', linewidth=0.5, zorder=0)
    for sp in ax.spines.values(): sp.set_visible(False)  # remover bordas do plot
    fig.tight_layout(pad=0.3)
    return fig_to_img(fig)

# =============================================================================
# GRÁFICO 4 — JORNADAS DE CONVERSÃO (substitui tabela de sequências)
# =============================================================================
# PROBLEMA ORIGINAL: tabela de strings como "PINV>SAUD>QUEIXA>APRO>PONTE"
# parece log de programador. Gestores não leem logs.
#
# SOLUÇÃO: desenhar cada caminho como uma sequência visual de CAIXAS + SETAS
# usando matplotlib.patches.FancyBboxPatch (caixas arredondadas) e
# ax.annotate() para as setas com taxa de conversão acima de cada transição.
#
# Por que matplotlib e não reportlab para isso?
# reportlab não tem primitivas de seta/caixa conectada nativamente.
# matplotlib tem controle pixel-a-pixel do canvas.
journeys = [
    {
        'label': 'Caminho principal — agendamento',
        'color': '#1D9E75',
        'stages': ['Queixa\npaciente', 'Validação\nda queixa', 'Convite\navaliação',
                   'Coleta\ndados', 'Handoff\nAgendamento'],
        'rates':  ['39.4%', '94.4%', '45.2%', '35%'],
    },
    {
        'label': 'Caminho alternativo — e-book',
        'color': '#378ADD',
        'stages': ['Queixa\npaciente', 'Explicação\nGB', 'Convite\navaliação',
                   'Ebook\nOferta', 'Handoff\nE-book'],
        'rates':  ['48.5%', '64.0%', '29.0%', '63.6%'],
    },
    {
        'label': 'Caminho rápido — direto ao investimento',
        'color': '#BA7517',
        'stages': ['Queixa\npaciente', 'Perg.\nInvestimento', 'Invest.\nConsulta',
                   'Coleta\ndados', 'Handoff\nAgendamento'],
        'rates':  ['30.3%', '78.9%', '53.3%', '35%'],
    },
]

def make_journey_chart(w_in, h_in):
    fig, ax = plt.subplots(figsize=(w_in, h_in))
    fig.patch.set_alpha(0); ax.set_facecolor('none')
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.axis('off')

    n_journeys = len(journeys)
    row_h  = 1.0 / n_journeys   # altura de cada "linha" de jornada
    n_stg  = 5                   # número de etapas por jornada
    col_w  = 0.13                # largura de cada caixa de etapa
    x_gap  = 0.04                # espaço para seta entre caixas
    x0     = 0.01                # margem esquerda
    box_h  = 0.21                # altura das caixas

    for ji, j in enumerate(journeys):
        col   = j['color']
        y_mid = 1 - (ji + 0.5) * row_h        # centro vertical da linha
        y_top = 1 - ji * row_h                 # topo da linha (para o label)

        # Nome do caminho (header da linha)
        ax.text(x0, y_top - 0.025, j['label'],
                ha='left', va='top', fontsize=6.5, fontweight='bold', color=col)

        for si, stage in enumerate(j['stages']):
            bx = x0 + si * (col_w + x_gap)    # posição X da caixa
            by = y_mid - box_h / 2             # posição Y (base da caixa)

            # Caixa arredondada com cor transparente
            rect = mpatches.FancyBboxPatch(
                (bx, by), col_w, box_h,
                boxstyle="round,pad=0.008",
                facecolor=col, alpha=0.13,
                edgecolor=col, linewidth=0.9, zorder=3
            )
            ax.add_patch(rect)

            # Nome da etapa dentro da caixa
            ax.text(bx + col_w / 2, by + box_h / 2, stage,
                    ha='center', va='center', fontsize=5.8,
                    color='#2C2C2A', linespacing=1.3, zorder=4)

            # Seta + taxa de conversão entre esta e a próxima caixa
            if si < n_stg - 1:
                arr_x0 = bx + col_w + 0.003           # início da seta
                arr_x1 = bx + col_w + x_gap - 0.003   # fim da seta
                ax.annotate('',
                    xy=(arr_x1, y_mid), xytext=(arr_x0, y_mid),
                    arrowprops=dict(arrowstyle='->', color=col, lw=1.0),
                    zorder=4
                )
                # Taxa ACIMA da caixa seguinte (evita colidir com texto interno)
                # Posicionamento: by + box_h + margem pequena
                ax.text((arr_x0 + arr_x1) / 2, by + box_h + 0.025,
                        j['rates'][si], ha='center', va='bottom',
                        fontsize=5.5, color=col, fontweight='bold', zorder=4)

    fig.tight_layout(pad=0)
    return fig_to_img(fig)

# =============================================================================
# SETUP DO DOCUMENTO REPORTLAB
# =============================================================================
doc = SimpleDocTemplate(
    'relatorio_dra_andressa_final.pdf',
    pagesize=A4,
    leftMargin=16*mm, rightMargin=16*mm,
    topMargin=13*mm,  bottomMargin=13*mm
)
# Área útil horizontal = largura A4 − margens L e R
usable = W - 32*mm   # ~531 pontos

# =============================================================================
# SISTEMA DE ESTILOS DE TEXTO
# =============================================================================
# reportlab não tem CSS. Cada estilo de texto é um objeto ParagraphStyle.
# Helper S() reduz o boilerplate de ParagraphStyle(name, fontName=..., ...)
# para S('nome', fontSize=..., ...) — mesmo resultado, menos ruído visual.
def S(name, **kw):
    return ParagraphStyle(name, **kw)

# Hierarquia de estilos: T=título, V=valor KPI, Sec=seção, lbl=label pequeno
sT18  = S('T18',  fontName='Helvetica-Bold', fontSize=17, textColor=C['text'],    leading=21)
sSub  = S('Sub',  fontName='Helvetica',      fontSize=7.5,textColor=C['muted'],   leading=11, letterSpacing=0.5)
sLbl  = S('Lbl',  fontName='Helvetica',      fontSize=6.5,textColor=C['muted'],   leading=9,  letterSpacing=0.3)
sV20  = S('V20',  fontName='Helvetica-Bold', fontSize=20, textColor=C['text'],    leading=24)
sVGrn = S('VGrn', fontName='Helvetica-Bold', fontSize=20, textColor=C['green'],   leading=24)
sVAmb = S('VAmb', fontName='Helvetica-Bold', fontSize=20, textColor=C['amber'],   leading=24)
sVBlu = S('VBlu', fontName='Helvetica-Bold', fontSize=20, textColor=C['blue'],    leading=24)
sXS   = S('XS',   fontName='Helvetica',      fontSize=6.5,textColor=C['muted'],   leading=9)
sMut  = S('Mut',  fontName='Helvetica',      fontSize=7.5,textColor=C['muted'],   leading=11)
sBod  = S('Bod',  fontName='Helvetica',      fontSize=7.5,textColor=C['text'],    leading=11)
sSec  = S('Sec',  fontName='Helvetica-Bold', fontSize=10, textColor=C['text'],    leading=13, spaceBefore=2, spaceAfter=3)
sR    = S('R',    fontName='Helvetica',      fontSize=7.5,textColor=C['muted'],   leading=10, alignment=TA_RIGHT)
sRB   = S('RB',   fontName='Helvetica-Bold', fontSize=8.5,textColor=C['text'],    leading=11, alignment=TA_RIGHT)
sCenB = S('CenB', fontName='Helvetica-Bold', fontSize=12, textColor=C['text'],    leading=15, alignment=TA_CENTER)
sCenS = S('CenS', fontName='Helvetica',      fontSize=6.5,textColor=C['muted'],   leading=9,  alignment=TA_CENTER)
sGT   = S('GT',   fontName='Helvetica-Bold', fontSize=7.5,textColor=C['green_dk'],leading=11)
sGB   = S('GB',   fontName='Helvetica',      fontSize=6.5,textColor=C['green_md'],leading=10)
sAT   = S('AT',   fontName='Helvetica-Bold', fontSize=7.5,textColor=C['amber_dk'],leading=11)
sAB   = S('AB',   fontName='Helvetica',      fontSize=6.5,textColor=C['amber_md'],leading=10)
sBT   = S('BT',   fontName='Helvetica-Bold', fontSize=7.5,textColor=C['blue_dk'], leading=11)
sBB   = S('BB',   fontName='Helvetica',      fontSize=6.5,textColor=C['blue_md'], leading=10)
sFoot = S('Ft',   fontName='Helvetica',      fontSize=6.5,textColor=C['border'],  leading=9)
sFotR = S('FtR',  fontName='Helvetica',      fontSize=6.5,textColor=C['border'],  leading=9, alignment=TA_RIGHT)

# =============================================================================
# HELPERS DE LAYOUT
# =============================================================================
# reportlab não tem flexbox/grid — tudo é Table aninhada.
# sec_label(): título de seção com barra verde à esquerda (via LINEBEFORE).
# kpi_cell(): card KPI com label, valor grande, subtexto.
# final_panel(): painel de etapa final com barra de progresso por trilha.
# insight_box(): caixa de insight colorida com borda colorida lateral.

def sec_label(text, w=None):
    """Título de seção com linha verde decorativa à esquerda."""
    t = Table([[Paragraph(text, sSec)]], colWidths=[w or usable])
    t.setStyle(TableStyle([
        ('LINEBEFORE',(0,0),(0,0), 2.5, C['green']),
        ('LEFTPADDING',(0,0),(0,0),8), ('RIGHTPADDING',(0,0),(0,0),0),
        ('TOPPADDING',(0,0),(0,0),0),  ('BOTTOMPADDING',(0,0),(0,0),3),
    ]))
    return t

def kpi_cell(label, val_p, sub):
    """Card KPI: label pequeno / valor grande / subtexto."""
    t = Table([
        [Paragraph(label.upper(), sLbl)],
        [val_p],
        [Paragraph(sub, sXS)]
    ])
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(0,2), C['light']),
        ('TOPPADDING',(0,0),(-1,-1),9),  ('BOTTOMPADDING',(0,0),(-1,-1),3),
        ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),6),
    ]))
    return t

def final_panel(title, total, ia_pct, hyb_pct, ia_n, hyb_n, bg, accent, title_col, w):
    """
    Painel de etapa final com campos novos (final_stage_conversion_by_track).
    Mostra: contagem total + barra proporcional IA pura vs Híbrida.
    A barra é uma Table de 1 célula com background colorido (hack de "div" no reportlab).
    """
    def trow(lbl, col, pct, n):
        # Barra: largura em pontos proporcional ao percentual (escala 0.75pt/%)
        bw = max(4, int(pct * 0.75))
        bar = Table([['']], colWidths=[bw])
        bar.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(0,0), colors.HexColor(col)),
            ('TOPPADDING',(0,0),(0,0),0), ('BOTTOMPADDING',(0,0),(0,0),0),
            ('LEFTPADDING',(0,0),(0,0),0), ('RIGHTPADDING',(0,0),(0,0),0),
            ('ROWHEIGHT',(0,0),(0,0), 5),
        ]))
        return [
            Paragraph(lbl, S('_l',fontName='Helvetica',fontSize=6.5,
                               textColor=C['muted'],leading=9)),
            bar,
            Paragraph(f'<b><font color="{col}">{pct:.1f}%</font></b>'
                      f'<font color="#888780"> ({n})</font>',
                      S('_r',fontName='Helvetica',fontSize=6.5,
                        textColor=C['text'],leading=9,alignment=TA_RIGHT)),
        ]

    track_tbl = Table([
        trow('IA pura', '#1D9E75', ia_pct, ia_n),
        trow('Híbrida', '#378ADD', hyb_pct, hyb_n),
    ], colWidths=[36, 82, 46])
    track_tbl.setStyle(TableStyle([
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('TOPPADDING',(0,0),(-1,-1),3), ('BOTTOMPADDING',(0,0),(-1,-1),3),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
        ('LINEBELOW',(0,0),(-1,0), 0.4, C['border']),  # linha entre IA e Híbrida
    ]))

    count_tbl = Table([
        [Paragraph(f'{total}', sCenB)],
        [Paragraph('convertidos', sCenS)],
    ], colWidths=[42])
    count_tbl.setStyle(TableStyle([
        ('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ]))

    # Layout interno: número à esquerda, barras à direita
    inner_row = Table([[count_tbl, track_tbl]], colWidths=[42, 170])
    inner_row.setStyle(TableStyle([
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),4),
    ]))

    content = Table([
        [Paragraph(title, S('_t', fontName='Helvetica-Bold', fontSize=7.5,
                              textColor=colors.HexColor(title_col), leading=10))],
        [Spacer(1, 3)],
        [inner_row],
    ], colWidths=[w - 22])
    content.setStyle(TableStyle([
        ('TOPPADDING',(0,0),(-1,-1),1), ('BOTTOMPADDING',(0,0),(-1,-1),1),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ]))

    # Container externo com fundo colorido + borda lateral
    outer = Table([[content]], colWidths=[w - 6])
    outer.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(0,0), colors.HexColor(bg)),
        ('LINEBEFORE',(0,0),(0,0), 3, colors.HexColor(accent)),
        ('LEFTPADDING',(0,0),(0,0),12),('RIGHTPADDING',(0,0),(0,0),8),
        ('TOPPADDING',(0,0),(0,0),9),  ('BOTTOMPADDING',(0,0),(0,0),9),
    ]))
    return outer

def insight_box(bg_hex, acc_hex, title_s, body_s, title, body, w):
    """Caixa de insight com borda colorida lateral e fundo tênue."""
    inner = Table([
        [Paragraph(title, title_s)],
        [Paragraph(body,  body_s)],
    ], colWidths=[w - 24])
    inner.setStyle(TableStyle([
        ('TOPPADDING',(0,0),(-1,-1),1), ('BOTTOMPADDING',(0,0),(-1,-1),1),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ]))
    outer = Table([[inner]], colWidths=[w - 6])
    outer.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(0,0), colors.HexColor(bg_hex)),
        ('LINEBEFORE',(0,0),(0,0), 3, colors.HexColor(acc_hex)),
        ('LEFTPADDING',(0,0),(0,0),12),('RIGHTPADDING',(0,0),(0,0),8),
        ('TOPPADDING',(0,0),(0,0),9), ('BOTTOMPADDING',(0,0),(0,0),9),
    ]))
    return outer

# =============================================================================
# MONTAGEM DA HISTÓRIA (story) — PÁGINA 1
# =============================================================================
# reportlab funciona como uma fila (story): você empilha Paragraphs, Tables,
# Spacers, Images e HRFlowables. O doc.build() distribui automaticamente
# em páginas, respeitando margens. PageBreak() força nova página.
story = []

# ── Cabeçalho ────────────────────────────────────────────────────────────────
# Table de 2 colunas: título à esquerda, datas à direita.
hdr = Table([[
    Paragraph('Relatório de Atendimentos', sT18),
    Table([[Paragraph('Período analisado', sR)],
           [Paragraph('13 – 18 de abril de 2026', sRB)]],
          colWidths=[120])
]], colWidths=[usable - 120, 120])
hdr.setStyle(TableStyle([
    ('VALIGN',(0,0),(-1,-1),'BOTTOM'),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),5),
]))
story.append(hdr)
story.append(Paragraph(
    'ANÁLISE DE PERFORMANCE  ·  IA + HUMANO  ·  CLÍNICA DRA. ANDRESSA  ·  UNITÀ', sSub))
story.append(HRFlowable(width='100%', thickness=0.5, color=C['border'],
                         spaceAfter=8, spaceBefore=5))

# ── KPIs (5 cards em linha) ──────────────────────────────────────────────────
# O 5º KPI (Handoff) é NOVO — vem do campo final_stages_detected da análise.
kpi_w = (usable - 12) / 5  # largura igual dividida pelos 5 cards
story.append(Table([[
    kpi_cell('Atendimentos',         Paragraph('54',    sV20), 'de 131 conversas totais'),
    kpi_cell('IA autônoma',          Paragraph('81.5%', sVGrn),'44 leads 100% IA'),
    kpi_cell('Convite avaliação',    Paragraph('57.4%', sVGrn),'31 de 54 chegaram ao convite'),
    kpi_cell('Handoff agendamento',  Paragraph('16.7%', sVBlu),'9 encaminhados à equipe'),
    kpi_cell('Fluxos fora de ordem', Paragraph('30',    sVAmb),'ponto de atenção'),
]], colWidths=[kpi_w]*5))
story[-1].setStyle(TableStyle([
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),8),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),3),
]))
story.append(Spacer(1, 7))

# ── Linha 1: Funil (54%) + coluna direita: Donut + Daily (46%) ───────────────
fc_w = usable * 0.54
rc_w = usable - fc_w - 10  # 10pt de gap entre colunas

# Imagens geradas pelo matplotlib, redimensionadas mantendo aspect ratio
funnel_h_in = 4.0
funnel_img = Image(make_funnel_chart(5.8, funnel_h_in),
                   width=fc_w - 14, height=(fc_w - 14) * funnel_h_in / 5.8)
donut_sz   = rc_w * 0.52
donut_img  = Image(make_donut_chart(2.2), width=donut_sz, height=donut_sz)
daily_img  = Image(make_daily_chart(3.2, 1.7),
                   width=rc_w - 12, height=(rc_w - 12) * 1.7 / 3.2)

# Legenda do donut (cores manuais via rich text do reportlab: <font color="...">■</font>)
legend_tbl = Table([
    [Paragraph('<font color="#1D9E75">■</font> IA pura', sBod), Paragraph('44', sBod), Paragraph('81.5%', sMut)],
    [Paragraph('<font color="#378ADD">■</font> Híbrida', sBod), Paragraph('10', sBod), Paragraph('18.5%', sMut)],
    [Paragraph('<font color="#888780">■</font> Humano',  sBod), Paragraph('0',  sBod), Paragraph('—',     sMut)],
], colWidths=[72, 18, 28], rowHeights=13)
legend_tbl.setStyle(TableStyle([
    ('FONTSIZE',(0,0),(-1,-1),7.5),('TEXTCOLOR',(0,0),(-1,-1),C['text']),
    ('TOPPADDING',(0,0),(-1,-1),1), ('BOTTOMPADDING',(0,0),(-1,-1),1),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
]))

# Coluna direita: stacked vertically com Table de 1 coluna
right_panel = Table([
    [sec_label('Distribuição por trilha', rc_w)],
    [Table([[donut_img, legend_tbl]], colWidths=[donut_sz + 4, rc_w - donut_sz - 4])],
    [Spacer(1, 5)],
    [sec_label('Volume diário de atendimentos', rc_w)],  # CAMPO NOVO
    [daily_img],
    [Table([[
        Paragraph('<font color="#1D9E75">■</font> IA pura', sMut),
        Paragraph('<font color="#378ADD">■</font> Híbrida', sMut),
    ]], colWidths=[rc_w//2, rc_w//2])],
], colWidths=[rc_w])
right_panel.setStyle(TableStyle([
    ('VALIGN',(0,1),(0,1),'MIDDLE'),
    ('TOPPADDING',(0,0),(-1,-1),1), ('BOTTOMPADDING',(0,0),(-1,-1),1),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
]))

funnel_col = Table([
    [sec_label('Funil de atendimento — macro-fases', fc_w)],
    [funnel_img],
], colWidths=[fc_w])
funnel_col.setStyle(TableStyle([
    ('TOPPADDING',(0,0),(-1,-1),1), ('BOTTOMPADDING',(0,0),(-1,-1),1),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
]))

# Layout de 2 colunas: Table com 2 células na linha
row1 = Table([[funnel_col, right_panel]], colWidths=[fc_w, rc_w])
row1.setStyle(TableStyle([
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ('COLPADDING',(0,0),(1,0),10),  # 10pt de espaço entre colunas
]))
story.append(row1)
story.append(Spacer(1, 8))

# ── Linha 2: Painéis de etapas finais (CAMPO NOVO: final_stage_conversion_by_track)
story.append(sec_label('Conversão para etapas finais'))
half_w = (usable - 8) / 2

fs_row = Table([[
    final_panel('Handoff agendamento — encaminhados para consulta',
                9, 15.9, 20.0, 7, 2, '#E1F5EE', '#1D9E75', '#085041', half_w),
    final_panel('Handoff e-book — guia de skincare entregue',
                7,  6.8, 40.0, 3, 4, '#E6F1FB', '#378ADD', '#0C447C', half_w),
]], colWidths=[half_w, half_w])
fs_row.setStyle(TableStyle([
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ('COLPADDING',(0,0),(1,0),8),
]))
story.append(fs_row)

# ── Rodapé página 1 ──────────────────────────────────────────────────────────
story.append(Spacer(1, 8))
story.append(HRFlowable(width='100%', thickness=0.5, color=C['border'], spaceAfter=5))
story.append(Table([
    [Paragraph('LeãoCorp Analytics — gerado em 18/04/2026', sFoot),
     Paragraph('Página 1 de 2  ·  account 35175698 · run 45d84703', sFotR)]
], colWidths=[usable/2, usable/2]))
story[-1].setStyle(TableStyle([
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
]))

# =============================================================================
# PÁGINA 2
# =============================================================================
story.append(PageBreak())

story.append(Paragraph('Detalhe Analítico — Conversões e Jornadas', sT18))
story.append(Paragraph('CLÍNICA DRA. ANDRESSA  ·  UNITÀ  ·  13–18 ABR 2026', sSub))
story.append(HRFlowable(width='100%', thickness=0.5, color=C['border'],
                         spaceAfter=10, spaceBefore=5))

half2 = (usable - 8) / 2

# ── Tabela de conversões ─────────────────────────────────────────────────────
# CORREÇÃO DE LAYOUT: colunas com larguras fixas explícitas (CW) para
# evitar que "CONVITE AVAL." ou "RECORRENTE" quebrem para duas linhas.
# Regra: soma das colWidths deve ser <= half2.
def rate_col(r):
    if r >= 70: return '#1D9E75'
    if r >= 45: return '#378ADD'
    return '#BA7517'

CW = [60, 12, 60, 40]   # from + seta + to + pct = 172pt (< half2 ≈ 261pt)
conv_data = [
    ('VALID. QUEIXA', 'CONVITE AVAL.',  94.4),
    ('PERG. INVEST.', 'INV. CONSULTA',  78.9),
    ('QUEIXA PAC.',   'CONVITE AVAL.',  72.7),
    ('VALID. QUEIXA', 'PONTE TRAT.',    66.7),
    ('PONTE TRAT.',   'CONVITE AVAL.',  82.4),
    ('EXPLIC. GB',    'CONVITE AVAL.',  64.0),
    ('INV. CONSULTA', 'COLETA DADOS',   53.3),
    ('QUEIXA PAC.',   'PONTE TRAT.',    54.5),
    ('QUEIXA PAC.',   'COLETA DADOS',   42.4),
    ('PERG. INVEST.', 'COLETA DADOS',   42.1),
]
conv_rows = []
for fr, to, r in conv_data:
    rc = rate_col(r)
    conv_rows.append([
        Paragraph(fr, S('fr',fontName='Helvetica',fontSize=7,textColor=C['muted'],leading=10)),
        Paragraph('→',S('ar',fontName='Helvetica',fontSize=7,
                         textColor=colors.HexColor('#b4b2a9'),leading=10,alignment=TA_CENTER)),
        Paragraph(f'<b>{to}</b>',
                  S('to',fontName='Helvetica-Bold',fontSize=7,textColor=C['text'],leading=10)),
        Paragraph(f'<b><font color="{rc}">{r:.1f}%</font></b>',
                  S('pc',fontName='Helvetica-Bold',fontSize=7.5,leading=10,
                    textColor=colors.HexColor(rc),alignment=TA_RIGHT)),
    ])

conv_tbl = Table(conv_rows, colWidths=CW, rowHeights=17)
conv_tbl.setStyle(TableStyle([
    ('LINEBELOW',(0,0),(-1,-2), 0.4, C['border']),
    ('TOPPADDING',(0,0),(-1,-1),3), ('BOTTOMPADDING',(0,0),(-1,-1),3),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),2),
    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
    ('ALIGN',(1,0),(1,-1),'CENTER'), ('ALIGN',(3,0),(3,-1),'RIGHT'),
]))

# ── Cards de destaque (3 maiores taxas) ──────────────────────────────────────
highlights = [
    ('94.4%','Validação → Convite',  'Maior taxa do funil — leads que passam pela validação da queixa convertem com altíssima eficácia.','#1D9E75','#E1F5EE','#085041'),
    ('82.4%','Ponte → Convite',      'Leads qualificados que chegam à ponte de tratamento convertem com grande força para o convite.','#1D9E75','#E1F5EE','#085041'),
    ('78.9%','Perg. Invest. → Consulta','Quando o lead pergunta o preço e recebe o valor da consulta, quase 4 em cada 5 avançam.','#378ADD','#E6F1FB','#0C447C'),
]
hl_rows = []
for pct, path, desc, acc_hex, bg_hex, txt_hex in highlights:
    box = Table([
        [Table([[
            Paragraph(pct,  S('hp', fontName='Helvetica-Bold', fontSize=16,
                               textColor=colors.HexColor(acc_hex), leading=19)),
            Paragraph(f'<b>{path}</b>',
                      S('hpa', fontName='Helvetica-Bold', fontSize=7.5,
                        textColor=colors.HexColor(txt_hex), leading=10)),
        ]], colWidths=[44, half2 - 62])],
        [Paragraph(desc, S('hd', fontName='Helvetica', fontSize=6.5,
                            textColor=colors.HexColor(acc_hex), leading=9.5))],
    ], colWidths=[half2 - 22])
    box.setStyle(TableStyle([
        ('TOPPADDING',(0,0),(-1,-1),2), ('BOTTOMPADDING',(0,0),(-1,-1),2),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
        ('VALIGN',(0,0),(0,0),'MIDDLE'),
    ]))
    outer = Table([[box]], colWidths=[half2 - 6])
    outer.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(0,0), colors.HexColor(bg_hex)),
        ('LINEBEFORE',(0,0),(0,0), 3, colors.HexColor(acc_hex)),
        ('LEFTPADDING',(0,0),(0,0),10),('RIGHTPADDING',(0,0),(0,0),8),
        ('TOPPADDING',(0,0),(0,0),8), ('BOTTOMPADDING',(0,0),(0,0),8),
    ]))
    hl_rows.append([outer])
    hl_rows.append([Spacer(1, 5)])

hl_tbl = Table(hl_rows, colWidths=[half2])
hl_tbl.setStyle(TableStyle([
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
]))

# Linha com 2 colunas: tabela conversões | cards destaque
p2_left  = Table([[sec_label('Principais conversões', half2)], [conv_tbl]], colWidths=[half2])
p2_right = Table([[sec_label('Destaques de conversão', half2)], [hl_tbl]],  colWidths=[half2])
for tbl in (p2_left, p2_right):
    tbl.setStyle(TableStyle([
        ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
        ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ]))

p2_row1 = Table([[p2_left, p2_right]], colWidths=[half2, half2])
p2_row1.setStyle(TableStyle([
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ('COLPADDING',(0,0),(1,0),8),
]))
story.append(p2_row1)
story.append(Spacer(1, 12))

# ── Jornadas visuais ─────────────────────────────────────────────────────────
# SUBSTITUIÇÃO DA TABELA DE SEQUÊNCIAS: agora é um gráfico matplotlib com
# caixas e setas por caminho, legível em português, com taxas visíveis.
story.append(sec_label(
    'Jornadas de maior sucesso — os 3 caminhos que mais geram conversão'))
story.append(Image(make_journey_chart(7.2, 3.0),
                   width=usable, height=usable * 3.0 / 7.2))
story.append(Spacer(1, 4))
story.append(Paragraph(
    'As taxas indicam a conversão de cada etapa para a próxima dentro do caminho. '
    'Os percentuais são calculados sobre o total de leads que chegaram à etapa anterior.',
    S('cap', fontName='Helvetica', fontSize=6.5, textColor=C['muted'], leading=9.5)
))
story.append(Spacer(1, 10))

# ── 3 caixas de insight ──────────────────────────────────────────────────────
third = (usable - 16) / 3
story.append(Table([[
    insight_box('#FAEEDA','#BA7517', sAT, sAB,
                '⚠  30 fluxos fora de sequência',
                'Leads chegam fora da ordem esperada — com QUEIXA antes da saudação. '
                'O agente lida bem, mas revisar gatilhos de entrada pode reduzir anomalias.',
                third),
    insight_box('#E1F5EE','#1D9E75', sGT, sGB,
                '↑  Validação Queixa → Convite: 94.4%',
                'Maior taxa do funil. Leads que passam pela validação da queixa convertem '
                'com altíssima eficácia. Aumentar volume nessa etapa amplifica os agendamentos.',
                third),
    insight_box('#E6F1FB','#378ADD', sBT, sBB,
                '→  Híbrida converte 5.9× mais em e-book',
                'Handoff e-book: híbrida 40% vs IA pura 6.8%. '
                'Atendimentos com toque humano têm muito mais aderência ao e-book.',
                third),
]], colWidths=[third, third, third]))
story[-1].setStyle(TableStyle([
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ('COLPADDING',(0,0),(2,0),8),
]))
story.append(Spacer(1, 8))

# ── Rodapé página 2 ──────────────────────────────────────────────────────────
story.append(HRFlowable(width='100%', thickness=0.5, color=C['border'], spaceAfter=5))
story.append(Table([
    [Paragraph('LeãoCorp Analytics — gerado em 18/04/2026', sFoot),
     Paragraph('Página 2 de 2  ·  account 35175698 · run 45d84703', sFotR)]
], colWidths=[usable/2, usable/2]))
story[-1].setStyle(TableStyle([
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),
    ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0),
]))

# =============================================================================
# GERAR O PDF
# =============================================================================
# doc.build() percorre a story, distribui em páginas respeitando margens,
# e escreve o arquivo .pdf no caminho especificado no SimpleDocTemplate.
doc.build(story)
print("PDF gerado: relatorio_dra_andressa_final.pdf")