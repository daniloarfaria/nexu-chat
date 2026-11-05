const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

const CONFIG_FILE = path.join(__dirname, 'config.json');
const CHECKPOINT_FILE = path.join(__dirname, 'checkpoint.json');
const LOG_FILE = path.join(__dirname, 'log_atividades.txt');
const REPORT_FILE = path.join(__dirname, 'relatorio_disparos.txt');

let client = null;
let isRunning = false;
let sentCount = 0;
let lastQR = null; // Memória para o último QR Code
const SESSION_LIMIT = 50;

// --- FUNÇÕES AUXILIARES ---

function logToFile(msg) {
    const timestamp = new Date().toLocaleString();
    const fullMsg = `[${timestamp}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, fullMsg);
}

function addToReport(nome, telefone, status) {
    const timestamp = new Date().toLocaleString();
    const line = `${status.toUpperCase()} | ${timestamp} | Nome: ${nome} | Tel: ${telefone}\n`;
    fs.appendFileSync(REPORT_FILE, line);
}

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleString();
    const fullMsg = `[${timestamp}] [${type.toUpperCase()}] ${msg}`;
    
    console.log(fullMsg);
    
    // Salva no arquivo .txt
    fs.appendFileSync(LOG_FILE, fullMsg + '\n');
    
    // Envia para a UI
    io.emit('log', { msg, type, time: new Date().toLocaleTimeString() });
}

function loadConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function loadCheckpoint() {
    if (fs.existsSync(CHECKPOINT_FILE)) {
        return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    }
    return { lastProcessedRow: 0 };
}

function saveCheckpoint(row) {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastProcessedRow: row }, null, 2));
}

function formatPhone(phone) {
    let cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.length <= 11 && !cleaned.startsWith('55')) {
        cleaned = '55' + cleaned;
    }
    return cleaned;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Rotina de Auto-Update (Assíncrona para não travar)
function updateWWebJS() {
    logToFile('Verificando atualizações do sistema...');
    exec('npm install whatsapp-web.js@latest', (error) => {
        if (error) {
            logToFile('Erro silencioso no auto-update: ' + error.message);
        } else {
            logToFile('WhatsApp Web JS verificado/atualizado.');
        }
    });
}
updateWWebJS();

// --- CONFIGURAÇÃO EXPRESS ---

app.use(express.json());
app.use(express.static('public'));

// API Routes
app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
    res.json({ message: 'Configuração salva!' });
});
app.post('/api/reset', (req, res) => {
    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
    res.json({ message: 'Checkpoint resetado!' });
});
app.get('/api/files', (req, res) => {
    const files = fs.readdirSync(__dirname).filter(file => file.endsWith('.xlsx'));
    res.json(files);
});
app.get('/api/logout', async (req, res) => {
    try {
        if (client) {
            await client.logout();
            client = null;
        }
        if (fs.existsSync('./.wwebjs_auth')) {
            fs.rmSync('./.wwebjs_auth', { recursive: true, force: true });
        }
        res.json({ message: 'Sessão encerrada!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LÓGICA WHATSAPP & SOCKET ---

io.on('connection', (socket) => {
    console.log('Painel conectado.');
    
    // Envia o status atual para quem acabou de abrir a página
    if (client && client.info) {
        socket.emit('status', 'connected');
    } else if (lastQR) {
        socket.emit('qr', lastQR);
    }

    // Novo evento apenas para iniciar os disparos
    socket.on('start-disparos', () => {
        if (client && !isRunning) {
            io.emit('status', 'running');
            startDisparos();
        } else {
            log('Erro: WhatsApp não conectado ou já em execução.', 'error');
        }
    });

    socket.on('stop-bot', () => {
        isRunning = false;
        log('Automação pausada pelo usuário.', 'warning');
        io.emit('status', 'finished'); // Libera o botão na UI imediatamente
    });
});

// Inicia o WhatsApp automaticamente ao abrir o servidor
initWhatsApp();

function initWhatsApp() {
    if (client) return;

    log('Passo 1: Iniciando navegador e carregando motor...', 'info');
    logToFile('Iniciando instância automática do cliente.');

    client = new Client({
        authStrategy: new LocalAuth(),
        // Fixa uma versão estável do WhatsApp Web para evitar erros de atualização
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1053021455-alpha.html'
        },
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    // Feedback visual de carregamento
    let loadingTimeout = setTimeout(() => {
        if (!client.info && isRunning === false && !lastQR) {
            log('Passo 2: O motor está demorando mais que o esperado. Verificando...', 'warning');
        }
    }, 15000);

    client.on('qr', (qr) => {
        lastQR = qr;
        io.emit('qr', qr);
        log('Sessão não encontrada ou expirada. POR FAVOR, ESCANEIE O QR CODE.', 'warning');
    });

    client.on('ready', () => {
        lastQR = null;
        io.emit('status', 'connected');
        log('Passo 3: WhatsApp conectado e pronto para uso!', 'success');
    });

    client.on('loading_screen', (percent, message) => {
        log(`Passo 2: Carregando WhatsApp... ${percent}% (${message})`, 'info');
    });

    client.on('auth_failure', (msg) => {
        io.emit('status', 'disconnected');
        log('ERRO: Falha na autenticação. Por favor, deslogue e tente novamente.', 'error');
        client = null;
    });

    client.on('disconnected', (reason) => {
        io.emit('status', 'disconnected');
        log('AVISO: WhatsApp foi desconectado: ' + reason, 'warning');
        client = null;
        log('Tentando re-inicializar o motor em 5 segundos...', 'info');
        setTimeout(initWhatsApp, 5000);
    });

    client.initialize().catch(err => {
        log('Erro fatal ao iniciar WhatsApp: ' + err.message, 'error');
        client = null;
    });
}

async function startDisparos() {
    if (isRunning) return;
    
    // Verificação de saúde do cliente
    try {
        const state = await client.getState();
        if (state !== 'CONNECTED') {
            log('WhatsApp não parece estar conectado. Reconectando...', 'warning');
            client.initialize();
            return;
        }
    } catch (e) {
        log('Erro de conexão detectado. Por favor, recarregue a página ou aguarde a reconexão automática.', 'error');
        initWhatsApp();
        return;
    }

    isRunning = true;
    sentCount = 0;

    const config = loadConfig();
    const checkpoint = loadCheckpoint();
    
    if (!fs.existsSync(config.excel.file)) {
        log(`ERRO: Planilha ${config.excel.file} não encontrada.`, 'error');
        isRunning = false;
        return;
    }

    const workbook = XLSX.readFile(config.excel.file);
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    log(`Iniciando disparos para ${data.length - checkpoint.lastProcessedRow} contatos restantes.`);

    for (let i = checkpoint.lastProcessedRow; i < data.length; i++) {
        if (!isRunning) break;

        const contact = data[i];
        const fullNome = contact[config.excel.nameColumn] || 'Cliente';
        const nome = fullNome.split(' ')[0];
        const rawPhone = contact[config.excel.phoneColumn];

        if (!rawPhone || rawPhone.toString().trim() === "") {
            log(`Linha ${i + 1}: Campo de telefone vazio. Pulando...`, 'warning');
            addToReport(nome, 'VAZIO', 'FALTA DE NUMERO');
            saveCheckpoint(i + 1); 
            continue;
        }

        const cleanedPhone = formatPhone(rawPhone);
        const template = config.templates[Math.floor(Math.random() * config.templates.length)];
        const message = template.replace('{NOME}', nome);

        try {
            log(`[${i + 1}/${data.length}] Validando: ${nome}...`);

            // Monta o chatId diretamente no formato aceito pelo sendMessage
            const chatId = `${cleanedPhone}@c.us`;

            // Verifica se o número tem WhatsApp (protegido para não travar em bugs de lib)
            try {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    log(`Aviso: ${nome} (${cleanedPhone}) não possui WhatsApp. Pulando.`, 'warning');
                    addToReport(nome, cleanedPhone, 'SEM WHATSAPP');
                    saveCheckpoint(i + 1);
                    continue;
                }
            } catch (checkErr) {
                log(`[Aviso] Não foi possível verificar se ${nome} tem WhatsApp (${checkErr.message || checkErr}). Tentando enviar mesmo assim...`, 'warning');
            }

            // Simulação de digitação (opcional, não bloqueia o envio se falhar)
            try {
                const chat = await client.getChatById(chatId);
                await chat.sendStateTyping();
            } catch (typingErr) {
                // Silencioso - não exibe aviso para não poluir o log
            }

            await sleep(3000 + Math.random() * 5000);

            let media = null;
            if (config.mediaFile && fs.existsSync(config.mediaFile)) {
                media = MessageMedia.fromFilePath(config.mediaFile);
            }

            try {
                if (media) {
                    await client.sendMessage(chatId, media, { caption: message });
                } else {
                    await client.sendMessage(chatId, message);
                }
            } catch (sendErr) {
                log(`Falha real no envio para ${nome}: ${sendErr.message || sendErr}`, 'error');
                throw sendErr;
            }

            log(`Sucesso para ${nome}!`, 'success');
            addToReport(nome, cleanedPhone, 'SUCESSO'); // Adiciona ao relatório de sucesso
            saveCheckpoint(i + 1);
            sentCount++;

            if (sentCount >= SESSION_LIMIT) {
                log(`Limite de ${SESSION_LIMIT} envios atingido. Encerrando por segurança.`);
                isRunning = false;
                break;
            }

            const waitTime = Math.floor(Math.random() * (config.delays.max - config.delays.min + 1) + config.delays.min);
            log(`Próximo envio em ${waitTime}s...`, 'info');
            
            // Espera interrompível (checa a cada 1s se deve parar)
            for (let s = 0; s < waitTime; s++) {
                if (!isRunning) break;
                await sleep(1000);
            }

        } catch (err) {
            log(`Erro para ${nome}: ${err.message}`, 'error');
            
            // Se for um erro fatal de "Frame" ou "Protocolo", para tudo para evitar spam de erros
            if (err.message.includes('detached Frame') || err.message.includes('Protocol error')) {
                log('Erro fatal no navegador detectado. Parando automação para segurança.', 'error');
                isRunning = false;
                io.emit('status', 'disconnected');
                client = null; // Força nova inicialização
                break;
            }
        }
    }

    isRunning = false;
    log('Processo finalizado.');
    io.emit('status', 'finished');
}

server.listen(port, () => {
    console.log(`Painel pronto em http://localhost:${port}`);
});
