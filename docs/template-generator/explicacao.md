**Resumo rápido do que você precisa saber para replicar:**

É Python, não HTML/CSS/JS. Duas bibliotecas fazem todo o trabalho — `pip install reportlab matplotlib numpy` e está pronto para rodar.

**A arquitetura central** é simples: matplotlib gera cada gráfico como PNG em memória (`io.BytesIO`), reportlab embute esses PNGs dentro de um layout de tabelas aninhadas e serializa tudo para PDF. Não existe arquivo temporário em disco.

**Para adaptar para outro cliente** basta trocar os dados no topo do arquivo: `funnel_phases`, `daily_ia`/`daily_hyb`, `journeys` com os caminhos do novo funil, e o nome do arquivo de saída no `SimpleDocTemplate`. Roda com `python relatorio_pdf_comentado.py`.