import os
path = r'..\Report Preview\src\core\orchestrator.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

patch = '''          # --- REGRA DE NEGOCIO CVP/CVLI ---
          # CVP deve ser apenas contexto. Se CVLI recente <= 1 e sem faccao, cap no risco.
          import numpy as np
          for region_key, spec_data in self.specialists.items():
              nodes_gdf = spec_data['data']['nodes_gdf']
              node_features = spec_data['data']['node_features']
              x_raw_30d = node_features[:, -30:, 0] # CVLI (canal 0) dos ultimos 30 dias
              for idx, row in nodes_gdf.iterrows():
                  name_k = normalize_name(str(row['name']))
                  if name_k in combined_scores:
                      cvli_30d = np.sum(x_raw_30d[idx])
                      fac = str(row.get('faction', 'NEUTRO')).upper()
                      if cvli_30d <= 1 and ('NEUTRO' in fac or fac == 'N/A' or fac == 'ND'):
                          # Reduz forcadamente o impacto do CVP
                          combined_scores[name_k] = min(combined_scores[name_k], 15.0)

          self._log_predict_p10(combined_scores)'''

if '# --- REGRA DE NEGOCIO CVP/CVLI ---' not in content:
    content = content.replace('          self._log_predict_p10(combined_scores)', patch)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('PATCH_APPLIED')
else:
    print('ALREADY_PATCHED')
