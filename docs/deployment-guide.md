# Guia de Deploy — VPS Ubuntu

Guia operacional para deploy do `funnel-analyzer` em uma VPS Ubuntu usando Docker Compose + Caddy.

---

## Pré-requisitos

### Na VPS

- Ubuntu 22.04+ (LTS recomendado)
- Acesso SSH por chave (login por senha desabilitado)
- Usuário não-root com `sudo`
- Domínio apontando para o IP da VPS (registro A no DNS)

### Software necessário

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sudo sh

# Adicionar usuário ao grupo docker (evita usar sudo)
sudo usermod -aG docker $USER

# Sair e entrar novamente para aplicar o grupo
exit
```

Após reconectar, verificar:

```bash
docker --version
docker compose version
```

---

## Firewall

Liberar apenas as portas necessárias:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

A porta `3000` **não deve ser liberada** — o acesso à API é feito exclusivamente via Caddy nas portas 80/443.

---

## Deploy

### 1. Clonar o repositório

```bash
git clone <url-do-repositorio> ~/funnel-analyzer
cd ~/funnel-analyzer
```

### 2. Criar o arquivo `.env`

```bash
cp .env.example .env
nano .env
```

Preencher com os valores reais:

```
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=eyJ...token-real...
OPENAI_API_KEY=sk-...chave-real...
PORT=3000
CACHE_DIR=./cache
API_TOKEN=gerar-um-token-seguro-aqui
DOMAIN=api.seudominio.com
```

Para gerar um token seguro:

```bash
openssl rand -hex 32
```

**`DOMAIN`** deve ser o domínio real (ex: `api.seudominio.com`). O Caddy provisiona certificados HTTPS automaticamente quando um domínio válido é configurado.

### 3. Subir os serviços

```bash
docker compose up -d --build
```

O Caddy aguarda o healthcheck da aplicação antes de iniciar. Na primeira execução, o Caddy solicita automaticamente um certificado TLS via Let's Encrypt.

### 4. Verificar

```bash
# Status dos containers
docker compose ps

# Logs da aplicação
docker compose logs app

# Logs do proxy
docker compose logs proxy

# Testar o health endpoint
curl https://api.seudominio.com/health
```

Resposta esperada:

```json
{"ok": true}
```

---

## Operações do dia a dia

### Ver logs em tempo real

```bash
docker compose logs -f
docker compose logs -f app     # só a aplicação
docker compose logs -f proxy   # só o Caddy
```

### Reiniciar serviços

```bash
docker compose restart
```

### Parar tudo

```bash
docker compose down
```

### Atualizar a aplicação

```bash
cd ~/funnel-analyzer
git pull
docker compose up -d --build
```

O Caddy mantém os certificados TLS em um volume persistente — não são perdidos durante atualizações.

### Limpar imagens antigas

```bash
docker image prune -f
```

---

## Volumes persistentes

| Volume | Conteúdo | Perda de dados |
|--------|----------|----------------|
| `cache_data` | Cache de prompts processados | Reprocessamento (custo OpenAI) |
| `caddy_data` | Certificados TLS | Re-emissão automática |
| `caddy_config` | Configuração interna do Caddy | Recriada automaticamente |

Para backup do cache:

```bash
docker compose cp app:/app/cache ./backup-cache
```

Para limpar todos os volumes (use com cuidado):

```bash
docker compose down -v
```

---

## Troubleshooting

### Container `app` não fica healthy

```bash
docker compose logs app
```

Causas comuns:
- Variáveis de ambiente faltando no `.env`
- `SUPABASE_URL` ou `SUPABASE_KEY` inválidos

### Caddy não inicia

```bash
docker compose logs proxy
```

Causas comuns:
- `DOMAIN` não aponta para o IP da VPS (DNS não propagado)
- Portas 80/443 em uso por outro serviço (Apache, Nginx)
- Firewall bloqueando portas 80/443

### Certificado HTTPS não emitido

- Verificar se o domínio resolve para o IP correto: `dig +short api.seudominio.com`
- Verificar se portas 80 e 443 estão acessíveis externamente
- O Let's Encrypt precisa acessar a porta 80 para validação ACME

### Porta 3000 acessível externamente

Isso **não deveria acontecer** — o `compose.yaml` não publica a porta 3000. Se estiver acessível, verificar se há outro processo rodando fora do Docker:

```bash
sudo lsof -i :3000
```

---

## Segurança

- O `.env` contém segredos — **nunca versionar** no Git
- O `API_TOKEN` protege a API; o TLS protege o transporte — ambos são necessários
- `GET /health` é o único endpoint acessível sem autenticação
- Todas as outras rotas exigem header `Authorization: Bearer <API_TOKEN>`
- A aplicação roda como usuário não-root dentro do container
- Os containers reiniciam automaticamente após falhas ou reboot do host

### Teste de autenticação

```bash
# Sem token (deve retornar 401)
curl -s -o /dev/null -w "%{http_code}" https://api.seudominio.com/cache

# Com token (deve retornar 200)
curl -s -H "Authorization: Bearer SEU_TOKEN" https://api.seudominio.com/cache
```

---

## Arquitetura

```
Cliente → Caddy (TLS/80/443) → app (Node.js/3000) → Supabase + OpenAI
```

- O cliente nunca acessa a porta 3000 diretamente
- O Caddy termina TLS e encaminha para o serviço `app` via rede interna do Docker
- A aplicação é stateless (exceto cache em disco)
- Toda persistência de dados é feita no Supabase
