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
const initDB = indexedDB.open("CivicDB", 1);
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
            <div class="input-group" style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" id="f-cheio" style="width:20px;"> <label style="margin:0;">Tanque Cheio?</label>
            </div>
        `;
    } else if (tipo === 'manutencao') {
        formTitle.innerText = 'Nova Manutenção';
        formFields.innerHTML = `
            <div class="input-group"><label>Data</label><input type="date" id="f-data" required value="${hoje}"></div>
            <div class="input-group"><label>Peça/Serviço</label><input type="text" id="f-desc" required></div>
            <div class="input-group"><label>Valor Total (R$)</label><input type="number" step="0.01" id="f-valor" required></div>
            <div class="input-group"><label>Km Atual</label><input type="number" id="f-km" required></div>
            <div class="input-group"><label>Próxima Troca (Em Km)</label><input type="number" id="f-venc-km" placeholder="Ex: 10000"></div>
            <div class="input-group"><label>Próxima Troca (Data)</label><input type="date" id="f-venc-data"></div>
        `;
    }
    modalForm.classList.add('active');
}

registroForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = new Date().getTime().toString();
    let payload = {};

    if (formAtual === 'abastecimento') {
        const valor = parseFloat(document.getElementById('f-valor').value);
        const precoLitro = parseFloat(document.getElementById('f-litro').value);
        const litros = (valor / precoLitro).toFixed(2);
        
        payload = {
            action: 'addAbastecimento',
            id: id,
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
            id: id,
            data: document.getElementById('f-data').value,
            tipo: 'Corretiva/Preventiva',
            descricao: document.getElementById('f-desc').value,
            valorTotal: parseFloat(document.getElementById('f-valor').value),
            kmAtual: parseInt(document.getElementById('f-km').value),
            dataVencimento: document.getElementById('f-venc-data').value || '-',
            kmVencimento: document.getElementById('f-venc-km').value || '-'
        };
        dadosApp.manutencoes.unshift(payload);
    }

    salvarCacheLocal();
    adicionarFilaSync(payload);
    fecharModais();
    renderizarTelas();
    sincronizarNuvem();
});

// 4. LÓGICA OFFLINE-FIRST E SINCRONIZAÇÃO
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

// 5. RENDERIZAÇÃO DE INTERFACE E CÁLCULOS
function renderizarTelas() {
    const formatBRL = (val) => Number(val).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
    
    document.getElementById('lista-abastecimentos').innerHTML = dadosApp.abastecimentos.map(a => `
        <div class="card">
            <h4 class="card-title">${a.Data || a.data} <span class="badge ${a['Tanque Cheio'] === 'SIM' || a.tanqueCheio === 'SIM' ? 'bg-success' : 'bg-warning'}">${a['Tanque Cheio'] || a.tanqueCheio}</span></h4>
            <div class="card-row"><span>Km:</span> <span>${a['Km Atual'] || a.kmAtual}</span></div>
            <div class="card-row"><span>Litros:</span> <span>${a.Litros || a.litros} L</span></div>
            <div class="card-row valor-financeiro"><span>Total:</span> <span>${formatBRL(a['Valor Total'] || a.valorTotal)}</span></div>
        </div>
    `).join('');

    document.getElementById('lista-manutencoes').innerHTML = dadosApp.manutencoes.map(m => `
        <div class="card">
            <h4 class="card-title">${m.Data || m.data}</h4>
            <div class="card-row"><span>Serviço:</span> <span>${m.Descricao || m.descricao}</span></div>
            <div class="card-row"><span>Km Atual:</span> <span>${m['Km Atual'] || m.kmAtual}</span></div>
            <div class="card-row valor-financeiro"><span>Valor:</span> <span>${formatBRL(m['Valor Total'] || m.valorTotal)}</span></div>
            ${m['Km Vencimento'] !== '-' ? `<div class="card-row"><span style="color:var(--danger)">Vence (Km):</span> <span>${m['Km Vencimento'] || m.kmVencimento}</span></div>` : ''}
        </div>
    `).join('');

    let maiorKm = 0;
    dadosApp.abastecimentos.forEach(a => { if(Number(a['Km Atual'] || a.kmAtual) > maiorKm) maiorKm = Number(a['Km Atual'] || a.kmAtual); });
    dadosApp.manutencoes.forEach(m => { if(Number(m['Km Atual'] || m.kmAtual) > maiorKm) maiorKm = Number(m['Km Atual'] || m.kmAtual); });
    document.getElementById('dash-km-total').innerText = maiorKm + ' Km';

    const alertas = dadosApp.manutencoes.filter(m => m['Km Vencimento'] && m['Km Vencimento'] !== '-');
    let htmlAlertas = '';
    alertas.forEach(m => {
        const venceEm = Number(m['Km Vencimento'] || m.kmVencimento);
        const faltam = venceEm - maiorKm;
        if(faltam <= 1000) {
            htmlAlertas += `<div class="card-row" style="color:var(--danger); border-bottom:1px solid var(--border); padding-bottom:5px;"><span>${m.Descricao || m.descricao}:</span> <span>Vence em ${faltam} Km!</span></div>`;
        }
    });
    document.getElementById('dash-alertas').innerHTML = htmlAlertas || '<p style="color: var(--primary);">Nenhuma manutenção crítica próxima.</p>';

    const tanquesCheios = dadosApp.abastecimentos.filter(a => a['Tanque Cheio'] === 'SIM' || a.tanqueCheio === 'SIM').slice(0, 2);
    if(tanquesCheios.length === 2) {
        const kmRodados = Number(tanquesCheios[0]['Km Atual'] || tanquesCheios[0].kmAtual) - Number(tanquesCheios[1]['Km Atual'] || tanquesCheios[1].kmAtual);
        const litrosGanhos = Number(tanquesCheios[0].Litros || tanquesCheios[0].litros);
        const media = (kmRodados / litrosGanhos).toFixed(1);
        document.getElementById('dash-consumo').innerHTML = `
            <div class="card-row"><span>Média Km/L:</span> <span style="font-size:1.2em; color:var(--primary);">${media} Km/L</span></div>
            <div class="card-row"><span>Distância:</span> <span>${kmRodados} Km</span></div>
        `;
    } else {
        document.getElementById('dash-consumo').innerHTML = '<p style="color: #757575; font-size: 0.9em;">Requer pelo menos 2 registos de "Tanque Cheio" para calcular a média.</p>';
    }
}