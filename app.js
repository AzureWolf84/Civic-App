// URL do seu Google Apps Script (Back-end)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby6h3XJpy07zqT4AH3MfEDb8LfAb0kELDqP5-ZtAqx4J4XQ-TzMYazSvcojaNXoZHmC/exec";

// Variáveis de Estado
let db;
let dadosApp = { abastecimentos: [], manutencoes: [] };
let formAtual = '';

// Elementos UI
const btnHamburger = document.getElementById('btn-hamburger');
const sideMenu = document.getElementById('side-menu');
const overlay = document.getElementById('overlay');
const menuItems = document.querySelectorAll('.menu-item');
const views = document.querySelectorAll('.view');
const btnOficina = document.getElementById('btn-oficina');
const btnSync = document.getElementById('btn-sync');
const syncIndicator = document.getElementById('sync-indicator');
const fab = document.getElementById('fab');
const modalEscolha = document.getElementById('modal-escolha');
const modalForm = document.getElementById('modal-form');
const registroForm = document.getElementById('registro-form');
const formFields = document.getElementById('form-fields');
const formTitle = document.getElementById('form-title');

// 1. INICIALIZAÇÃO DO BANCO DE DADOS LOCAL (IndexedDB)
const initDB = indexedDB.open("CivicDB", 2);
initDB.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'tipo' });
    if (!db.objectStoreNames.contains('filaSync')) db.createObjectStore('filaSync', { keyPath: 'tempId' });
};
initDB.onsuccess = (e) => {
    db = e.target.result;
    carregarDadosLocais();
    sincronizarNuvem();
};

// 2. NAVEGAÇÃO E INTERFACE
function toggleMenu() {
    sideMenu.classList.toggle('open');
    overlay.classList.toggle('active');
}
btnHamburger.addEventListener('click', toggleMenu);
overlay.addEventListener('click', () => {
    sideMenu.classList.remove('open');
    overlay.classList.remove('active');
    fecharModais();
});

menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        menuItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        views.forEach(v => v.classList.remove('active'));
        document.getElementById(item.getAttribute('data-target')).classList.add('active');
        toggleMenu();
        renderizarTelas();
    });
});

btnOficina.addEventListener('click', () => {
    document.body.classList.toggle('modo-oficina');
    btnOficina.style.opacity = document.body.classList.contains('modo-oficina') ? '0.5' : '1';
});

fab.addEventListener('click', () => { modalEscolha.classList.add('active'); });

function fecharModais() {
    modalEscolha.classList.remove('active');
    modalForm.classList.remove('active');
    registroForm.reset();
}

// 3. FORMULÁRIOS DINÂMICOS
function abrirFormulario(tipo) {
    modalEscolha.classList.remove('active');
    formAtual = tipo;
    formFields.innerHTML = '';
    
    const hoje = new Date().toISOString().split('T')[0];

    if (tipo === 'abastecimento') {
        formTitle.innerText = 'Novo Abastecimento';
        formFields.innerHTML = `
            <div class="input-group"><label>Data</label><input type="date" id="f-data" required value="${hoje}"></div>
            <div class="input-group"><label>Valor Total (R$)</label><input type="number" step="0.01" id="f-valor" required></div>
            <div class="input-group"><label>Preço por Litro (R$)</label><input type="number" step="0.01" id="f-litro" required></div>
            <div class="input-group"><label>Km Atual</label><input type="number" id="f-km" required></div>
            <div class="input-group" style="display:flex; align-items:center; gap:10px; margin-top:10px;">
                <input type="checkbox" id="f-cheio" style="width:20px; height:20px;"> <label style="margin:0; cursor:pointer;">Tanque Cheio?</label>
            </div>
        `;
    } else if (tipo === 'manutencao') {
        formTitle.innerText = 'Nova Manutenção';
        formFields.innerHTML = `
            <div class="input-group"><label>Data</label><input type="date" id="f-data" required value="${hoje}"></div>
            <div class="input-group"><label>Peça / Serviço</label><input type="text" id="f-desc" placeholder="Ex: Pastilhas de Travão" required></div>
            <div class="input-group"><label>Valor Total (R$)</label><input type="number" step="0.01" id="f-valor" required></div>
            <div class="input-group"><label>Km Atual</label><input type="number" id="f-km" required></div>
            <div class="input-group"><label>Próxima Troca (Em Km)</label><input type="number" id="f-venc-km" placeholder="Ex: 10000"></div>
            <div class="input-group"><label>Próxima Troca (Data)</label><input type="date" id="f-venc-data"></div>
        `;
    } else if (tipo === 'documento') {
        formTitle.innerText = 'Registar IPVA / Seguro';
        formFields.innerHTML = `
            <div class="input-group"><label>Data do Pagamento</label><input type="date" id="f-data" required value="${hoje}"></div>
            <div class="input-group"><label>Descrição / Obrigação</label><input type="text" id="f-desc" placeholder="Ex: IPVA 2026 - Parcela 1" required></div>
            <div class="input-group"><label>Valor Total (R$)</label><input type="number" step="0.01" id="f-valor" required></div>
            <div class="input-group"><label>Data de Vencimento</label><input type="date" id="f-venc-data"></div>
        `;
    }
    modalForm.classList.add('active');
}

registroForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const idUnico = 'ID_' + Date.now();
    let payload = {};

    if (formAtual === 'abastecimento') {
        const valor = parseFloat(document.getElementById('f-valor').value);
        const precoLitro = parseFloat(document.getElementById('f-litro').value);
        const litros = (valor / precoLitro).toFixed(2);
        
        payload = {
            action: 'addAbastecimento',
            id: idUnico,
            data: document.getElementById('f-data').value,
            valorTotal: valor,
            valorLitro: precoLitro,
            litros: litros,
            kmAtual: parseInt(document.getElementById('f-km').value),
            tanqueCheio: document.getElementById('f-cheio').checked ? 'SIM' : 'NÃO'
        };
        dadosApp.abastecimentos.unshift(payload); 
    } else if (formAtual === 'manutencao') {
        payload = {
            action: 'addManutencao',
            id: idUnico,
            data: document.getElementById('f-data').value,
            tipo: 'Corretiva/Preventiva',
            descricao: document.getElementById('f-desc').value,
            valorTotal: parseFloat(document.getElementById('f-valor').value),
            kmAtual: parseInt(document.getElementById('f-km').value),
            dataVencimento: document.getElementById('f-venc-data').value || '-',
            kmVencimento: document.getElementById('f-venc-km').value || '-'
        };
        dadosApp.manutencoes.unshift(payload);
    } else if (formAtual === 'documento') {
        payload = {
            action: 'addManutencao',
            id: idUnico,
            data: document.getElementById('f-data').value,
            tipo: 'Documentação/IPVA',
            descricao: document.getElementById('f-desc').value,
            valorTotal: parseFloat(document.getElementById('f-valor').value),
            kmAtual: 0,
            dataVencimento: document.getElementById('f-venc-data').value || '-',
            kmVencimento: '-'
        };
        dadosApp.manutencoes.unshift(payload);
    }

    salvarCacheLocal();
    adicionarFilaSync(payload);
    fecharModais();
    renderizarTelas();
    sincronizarNuvem();
});

// 4. FUNÇÃO DE EXCLUSÃO (Soft Delete integrado com Google Sheets)
function apagarRegistro(tipo, idAlvo) {
    if (!confirm("Tem certeza de que deseja remover este registo?")) return;

    let nomeAba = 'Abastecimentos';
    if (tipo === 'abastecimento') {
        dadosApp.abastecimentos = dadosApp.abastecimentos.filter(a => {
            const currentId = a.id || a.ID || a.tempId || '';
            return currentId !== idAlvo;
        });
        nomeAba = 'Abastecimentos';
    } else {
        dadosApp.manutencoes = dadosApp.manutencoes.filter(m => {
            const currentId = m.id || m.ID || m.tempId || '';
            return currentId !== idAlvo;
        });
        nomeAba = 'Manutencoes';
    }

    salvarCacheLocal();
    renderizarTelas();

    const payload = {
        action: 'softDelete',
        id: idAlvo,
        sheetName: nomeAba
    };
    adicionarFilaSync(payload);
    sincronizarNuvem();
}

// 5. LÓGICA OFFLINE-FIRST E SINCRONIZAÇÃO
function salvarCacheLocal() {
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put({ tipo: 'abastecimentos', dados: dadosApp.abastecimentos });
    tx.objectStore('cache').put({ tipo: 'manutencoes', dados: dadosApp.manutencoes });
}

function carregarDadosLocais() {
    const tx = db.transaction('cache', 'readonly');
    const store = tx.objectStore('cache');
    store.get('abastecimentos').onsuccess = (e) => { if(e.target.result) dadosApp.abastecimentos = e.target.result.dados; };
    store.get('manutencoes').onsuccess = (e) => { 
        if(e.target.result) dadosApp.manutencoes = e.target.result.dados; 
        renderizarTelas();
    };
}

function adicionarFilaSync(payload) {
    const tx = db.transaction('filaSync', 'readwrite');
    payload.tempId = Date.now();
    tx.objectStore('filaSync').put(payload);
}

async function sincronizarNuvem() {
    if (!navigator.onLine) {
        syncIndicator.classList.add('active');
        return;
    }
    syncIndicator.classList.remove('active');

    const txFila = db.transaction('filaSync', 'readwrite');
    const storeFila = txFila.objectStore('filaSync');
    storeFila.getAll().onsuccess = async (e) => {
        const fila = e.target.result;
        for (let item of fila) {
            try {
                await fetch(SCRIPT_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item)
                });
                db.transaction('filaSync', 'readwrite').objectStore('filaSync').delete(item.tempId);
            } catch (err) { console.error("Erro sync POST", err); }
        }
        
        fetch(SCRIPT_URL)
            .then(res => res.json())
            .then(json => {
                if(json.abastecimentos) dadosApp.abastecimentos = json.abastecimentos.reverse();
                if(json.manutencoes) dadosApp.manutencoes = json.manutencoes.reverse();
                salvarCacheLocal();
                renderizarTelas();
            })
            .catch(err => console.log("Modo offline ativo. Erro GET:", err));
    };
}

btnSync.addEventListener('click', sincronizarNuvem);
window.addEventListener('online', sincronizarNuvem);
window.addEventListener('offline', () => syncIndicator.classList.add('active'));

// 6. RENDERIZAÇÃO DE INTERFACE E CÁLCULOS
function renderizarTelas() {
    const formatBRL = (val) => Number(val).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    
    // Abastecimentos
    document.getElementById('lista-abastecimentos').innerHTML = dadosApp.abastecimentos.map(a => {
        const idReg = a.id || a.ID || a.tempId || Math.random();
        return `
        <div class="card">
            <h4 class="card-title">${a.Data || a.data} <span class="badge ${a['Tanque Cheio'] === 'SIM' || a.tanqueCheio === 'SIM' ? 'bg-success' : 'bg-warning'}">Tanque: ${a['Tanque Cheio'] || a.tanqueCheio}</span></h4>
            <div class="card-row"><span>Km Atual:</span> <span>${a['Km Atual'] || a.kmAtual} Km</span></div>
            <div class="card-row"><span>Litros:</span> <span>${a.Litros || a.litros} L</span></div>
            <div class="card-row valor-financeiro"><span>Valor Total:</span> <span>${formatBRL(a['Valor Total'] || a.valorTotal)}</span></div>
            <div style="text-align: right; margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px;">
                <button onclick="apagarRegistro('abastecimento', '${idReg}')" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:0.9em; font-weight:bold;">🗑️ Apagar Registo</button>
            </div>
        </div>
    `}).join('') || '<p style="color: var(--text-muted); text-align:center;">Nenhum abastecimento registado.</p>';

    // Manutenções de Oficina
    const manutencoesOficina = dadosApp.manutencoes.filter(m => (m.Tipo || m.tipo) !== 'Documentação/IPVA');
    document.getElementById('lista-manutencoes').innerHTML = manutencoesOficina.map(m => {
        const idReg = m.id || m.ID || m.tempId || Math.random();
        return `
        <div class="card">
            <h4 class="card-title">${m.Data || m.data} <span class="badge bg-success">OFICINA</span></h4>
            <div class="card-row"><span>Serviço:</span> <span>${m.Descricao || m.descricao}</span></div>
            <div class="card-row"><span>Km Atual:</span> <span>${m['Km Atual'] || m.kmAtual} Km</span></div>
            <div class="card-row valor-financeiro"><span>Valor:</span> <span>${formatBRL(m['Valor Total'] || m.valorTotal)}</span></div>
            ${m['Km Vencimento'] && m['Km Vencimento'] !== '-' ? `<div class="card-row"><span style="color:var(--danger)">Vence (Km):</span> <span>${m['Km Vencimento'] || m.kmVencimento} Km</span></div>` : ''}
            <div style="text-align: right; margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px;">
                <button onclick="apagarRegistro('manutencao', '${idReg}')" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:0.9em; font-weight:bold;">🗑️ Apagar Registo</button>
            </div>
        </div>
    `}).join('') || '<p style="color: var(--text-muted); text-align:center;">Nenhuma manutenção registada.</p>';

    // Documentação / IPVA
    const documentos = dadosApp.manutencoes.filter(m => (m.Tipo || m.tipo) === 'Documentação/IPVA');
    document.getElementById('lista-documentacao').innerHTML = documentos.map(d => {
        const idReg = d.id || d.ID || d.tempId || Math.random();
        return `
        <div class="card">
            <h4 class="card-title">${d.Data || d.data} <span class="badge bg-success">DOCUMENTO</span></h4>
            <div class="card-row"><span>Descrição:</span> <span>${d.Descricao || d.descricao}</span></div>
            <div class="card-row valor-financeiro"><span>Valor Pago:</span> <span>${formatBRL(d['Valor Total'] || d.valorTotal)}</span></div>
            ${d['Data Vencimento'] && d['Data Vencimento'] !== '-' ? `<div class="card-row"><span>Vencimento:</span> <span>${d['Data Vencimento'] || d.dataVencimento}</span></div>` : ''}
            <div style="text-align: right; margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px;">
                <button onclick="apagarRegistro('manutencao', '${idReg}')" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:0.9em; font-weight:bold;">🗑️ Apagar Registo</button>
            </div>
        </div>
    `}).join('') || '<p style="color: var(--text-muted); text-align:center;">Nenhuma obrigação / IPVA registada.</p>';

    // Dashboard - Hodômetro Geral
    let maiorKm = 0;
    dadosApp.abastecimentos.forEach(a => { if(Number(a['Km Atual'] || a.kmAtual) > maiorKm) maiorKm = Number(a['Km Atual'] || a.kmAtual); });
    dadosApp.manutencoes.forEach(m => { if(Number(m['Km Atual'] || m.kmAtual) > maiorKm) maiorKm = Number(m['Km Atual'] || m.kmAtual); });
    document.getElementById('dash-km-total').innerText = maiorKm + ' Km';

    // Dashboard - Alertas Manutenção
    const alertas = manutencoesOficina.filter(m => m['Km Vencimento'] && m['Km Vencimento'] !== '-');
    let htmlAlertas = '';
    alertas.forEach(m => {
        const venceEm = Number(m['Km Vencimento'] || m.kmVencimento);
        const faltam = venceEm - maiorKm;
        if(faltam <= 1000) {
            htmlAlertas += `<div class="card-row" style="color:var(--danger); border-bottom:1px solid var(--border); padding-bottom:5px; margin-bottom:5px;"><span>${m.Descricao || m.descricao}:</span> <span>Vence em ${faltam} Km!</span></div>`;
        }
    });
    document.getElementById('dash-alertas').innerHTML = htmlAlertas || '<p style="color: var(--text-muted); font-size: 0.9em; margin: 0;">Nenhuma manutenção crítica próxima.</p>';

    // Dashboard - Cálculo de Consumo
    const tanquesCheios = dadosApp.abastecimentos.filter(a => (a['Tanque Cheio'] || a.tanqueCheio) === 'SIM').slice(0, 2);
    if(tanquesCheios.length === 2) {
        const kmRodados = Number(tanquesCheios[0]['Km Atual'] || tanquesCheios[0].kmAtual) - Number(tanquesCheios[1]['Km Atual'] || tanquesCheios[1].kmAtual);
        const litrosGanhos = Number(tanquesCheios[0].Litros || tanquesCheios[0].litros);
        if(litrosGanhos > 0 && kmRodados > 0) {
            const media = (kmRodados / litrosGanhos).toFixed(1);
            document.getElementById('dash-consumo').innerHTML = `
                <div class="card-row"><span>Média Recente:</span> <span style="font-size:1.1em; color:var(--primary);">${media} Km/L</span></div>
                <div class="card-row"><span>Distância Entre Tanques:</span> <span>${kmRodados} Km</span></div>
            `;
        } else {
            document.getElementById('dash-consumo').innerHTML = '<p style="color: var(--text-muted); font-size: 0.9em; margin: 0;">Dados insuficientes para cálculo.</p>';
        }
    } else {
        document.getElementById('dash-consumo').innerHTML = '<p style="color: var(--text-muted); font-size: 0.9em; margin: 0;">Requer 2 registos de "Tanque Cheio" para iniciar a média.</p>';
    }
}