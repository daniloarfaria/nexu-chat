const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

// Caminho do arquivo de checkpoint
const CHECKPOINT_FILE = path.join(__dirname, 'checkpoint.json');

// Função para carregar o checkpoint
function loadCheckpoint() {
    if (fs.existsSync(CHECKPOINT_FILE)) {
        return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    }
    return { lastProcessedRow: 0 };
}

// Função para salvar o checkpoint
function saveCheckpoint(row) {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastProcessedRow: row }, null, 2));
}

// Função para formatar número de telefone (Padrão Brasil)
function formatPhone(phone) {
    let cleaned = phone.toString().replace(/\D/g, '');
    // Se não tiver o código do país (55), adiciona
    if (cleaned.length <= 11 && !cleaned.startsWith('55')) {
        cleaned = '55' + cleaned;
    }
    return cleaned;
}

// Função de delay aleatório
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
    const args = process.argv.slice(2);
    
    // Comando para Desconectar (Logout)
    if (args.includes('--logout')) {
        console.log('Desconectando e limpando sessão...');
        if (fs.existsSync('./.wwebjs_auth')) {
            fs.rmSync('./.wwebjs_auth', { recursive: true, force: true });
        }
        console.log('Sessão limpa com sucesso! Você pode conectar novamente com npm run login');
        return;
    }

    // Comando para Limpar Checkpoint (Reset)
    if (args.includes('--reset')) {
        console.log('Limpando checkpoint...');
        if (fs.existsSync(CHECKPOINT_FILE)) {
            fs.unlinkSync(CHECKPOINT_FILE);
        }
        console.log('Checkpoint limpo! O próximo disparo começará da primeira linha.');
        return;
    }

    const checkpoint = loadCheckpoint();
    console.log(`Iniciando automação a partir da linha: ${checkpoint.lastProcessedRow + 1}`);

    // Ler Excel
    const workbook = XLSX.readFile(config.excel.file);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (checkpoint.lastProcessedRow >= data.length) {
        console.log('Todos os contatos da planilha já foram processados!');
        return;
    }

    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log('Escaneie o QR Code abaixo para conectar:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', async () => {
        console.log('WhatsApp conectado com sucesso!');

        if (args.includes('--login')) {
            console.log('Modo de login apenas: Sessão ativa e pronta para uso.');
            console.log('Para iniciar os disparos, use: npm start');
            return; // Não inicia o loop de disparos
        }

        let sentCount = 0;
        const LIMIT = 50;

        for (let i = checkpoint.lastProcessedRow; i < data.length; i++) {
            const contact = data[i];
            const fullNome = contact[config.excel.nameColumn] || 'Cliente';
            const nome = fullNome.split(' ')[0]; // Pega apenas o primeiro nome
            const rawPhone = contact[config.excel.phoneColumn];

            if (!rawPhone) {
                console.log(`Linha ${i + 1}: Telefone não encontrado. Pulando...`);
                continue;
            }

            const cleanedPhone = formatPhone(rawPhone);
            const template = config.templates[Math.floor(Math.random() * config.templates.length)];
            const message = template.replace('{NOME}', nome);

            try {
                console.log(`[${i + 1}/${data.length}] Validando número para ${nome} (${cleanedPhone})...`);
                
                // Busca o ID correto do contato no WhatsApp (resolve o erro de LID)
                const numberId = await client.getNumberId(cleanedPhone);
                
                if (!numberId) {
                    console.log(`Linha ${i + 1}: O número ${cleanedPhone} não possui WhatsApp. Pulando...`);
                    continue;
                }

                const chatId = numberId._serialized;
                console.log(`Enviando para ${chatId}...`);
                
                // Simula presença
                const chat = await client.getChatById(chatId);
                await chat.sendStateTyping();
                
                // Delay curto para simular tempo de digitação
                await sleep(3000 + Math.random() * 5000);

                // Carrega a mídia se configurada
                let media = null;
                if (config.mediaFile && fs.existsSync(config.mediaFile)) {
                    media = MessageMedia.fromFilePath(config.mediaFile);
                }

                if (media) {
                    await client.sendMessage(chatId, media, { caption: message });
                } else {
                    await client.sendMessage(chatId, message);
                }
                
                console.log(`Mensagem enviada!`);

                saveCheckpoint(i + 1);
                sentCount++;

                if (sentCount >= LIMIT) {
                    console.log(`\n====================================================`);
                    console.log(`LIMITE DE ${LIMIT} ENVIOS ATINGIDO NESTA SESSÃO!`);
                    console.log(`O bot será encerrado para sua segurança.`);
                    console.log(`O checkpoint foi salvo. Você pode continuar amanhã.`);
                    console.log(`====================================================\n`);
                    process.exit(0);
                }

                // Delay aleatório entre envios para mitigar bloqueio
                const waitTime = Math.floor(Math.random() * (config.delays.max - config.delays.min + 1) + config.delays.min);
                console.log(`Aguardando ${waitTime} segundos até o próximo envio...`);
                await sleep(waitTime * 1000);

            } catch (err) {
                console.error(`Erro ao enviar para ${nome}:`, err.message);
                // Opcional: parar em caso de erro crítico ou continuar
            }
        }

        console.log('Processamento concluído!');
        process.exit(0);
    });

    client.initialize();
}

start().catch(err => console.error('Erro fatal:', err));
