// Script para cargar y mostrar datos del ranking desde la base de datos
class RankingManager {
  constructor() {
    // Determinar la URL base dinámicamente para soportar local, ngrok y producción
    const envBase = (typeof window !== 'undefined' && (window.API_BASE_URL || window.__API_BASE_URL__)) ||
                    (typeof localStorage !== 'undefined' && (localStorage.getItem('API_BASE_URL') || localStorage.getItem('api_base_url')));
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const base = envBase || origin || '';
    // Si no hay base detectable, usar ruta relativa (asume mismo origen que sirve el frontend)
    this.apiUrl = (base ? `${base}` : '') + '/api/ranking';
    this.init();
  }

  async init() {
    try {
      await this.loadRankingData();
    } catch (error) {
      console.error('Error al inicializar el ranking:', error);
      this.showError('Error al cargar los datos del ranking');
    }
  }

  async loadRankingData() {
    try {
      console.log('Cargando datos del ranking...');
      
      // Crear un token temporal para desarrollo
      const token = localStorage.getItem('token') || 'temp-token-dev';
      console.log('Token encontrado:', token);
      
      const response = await fetch(this.apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Error HTTP: ${response.status} - ${errorText}`);
      }

      const responseText = await response.text();
      console.log('Response text:', responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Error parsing JSON:', parseError);
        console.error('Response was:', responseText);
        throw new Error('El servidor no devolvió JSON válido');
      }
      
      if (data.success && data.ranking) {
        console.log('Datos del ranking recibidos:', data.ranking);
        this.updatePodium(data.ranking);
        this.updateOtherRanks(data.ranking);
      } else {
        throw new Error(data.message || 'Error al obtener datos del ranking');
      }
      
    } catch (error) {
      console.error('Error al cargar ranking:', error);
      this.showError('Error al conectar con la base de datos');
    }
  }

  updatePodium(ranking) {
    // Actualizar los top 3 del podio
    const top3 = ranking.slice(0, 3);
    
    // Segundo lugar
    if (top3[1]) {
      this.updatePodiumPosition('second', top3[1], 2);
    }
    
    // Primer lugar
    if (top3[0]) {
      this.updatePodiumPosition('first', top3[0], 1);
    }
    
    // Tercer lugar
    if (top3[2]) {
      this.updatePodiumPosition('third', top3[2], 3);
    }
  }

  updatePodiumPosition(position, agent, rank) {
    const podiumItem = document.querySelector(`.podium-item.${position}-place`);
    if (!podiumItem) return;

    // Actualizar nombre
    const nameElement = podiumItem.querySelector('.agent-info h3');
    if (nameElement) {
      nameElement.textContent = agent.nombre;
    }

    // Actualizar cargo
    const cargoElement = podiumItem.querySelector('.agent-info p');
    if (cargoElement) {
      cargoElement.textContent = agent.cargo;
    }

    // Actualizar puntuación
    const scoreElement = podiumItem.querySelector('.score');
    if (scoreElement) {
      scoreElement.textContent = agent.puntos.toFixed(1);
    }

    console.log(`Actualizado ${position} lugar: ${agent.nombre} - ${agent.puntos} puntos`);
  }

  updateOtherRanks(ranking) {
    // Actualizar posiciones 4 y 5
    const otherRanks = ranking.slice(3, 5);
    const rankList = document.querySelector('.rank-list');
    
    if (!rankList) return;

    // Limpiar lista actual
    rankList.innerHTML = '';

    otherRanks.forEach((agent, index) => {
      const position = index + 4; // Posiciones 4 y 5
      const rankItem = this.createRankItem(agent, position);
      rankList.appendChild(rankItem);
    });
  }

  createRankItem(agent, position) {
    const rankItem = document.createElement('div');
    rankItem.className = 'rank-item';
    
    rankItem.innerHTML = `
      <span class="rank-number">${position}</span>
      <div class="agent-info">
        <div class="agent-avatar">
          <i class="fas fa-user"></i>
        </div>
        <div class="agent-details">
          <h4>${agent.nombre}</h4>
          <p>${agent.cargo}</p>
        </div>
      </div>
      <div class="agent-stats">
        <span class="points">${agent.puntos.toFixed(1)} pts</span>
        <span class="sales">${agent.ventas} ventas</span>
      </div>
    `;
    
    return rankItem;
  }

  showError(message) {
    // Solo mostrar error en consola, no reemplazar el contenido HTML
    console.error('Error en ranking:', message);
    
    // Opcional: mostrar un mensaje discreto sin reemplazar todo el contenido
    const rankingHeader = document.querySelector('.ranking-header');
    if (rankingHeader) {
      const existingError = rankingHeader.querySelector('.error-message');
      if (!existingError) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.cssText = 'color: #ef4444; font-size: 0.9em; margin-top: 10px;';
        errorDiv.textContent = 'Datos no disponibles - mostrando información estática';
        rankingHeader.appendChild(errorDiv);
      }
    }
  }

  // Método para refrescar datos
  async refresh() {
    await this.loadRankingData();
  }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  // Verificar que estamos en la página de ranking
  if (document.querySelector('.circular-podium')) {
    console.log('Inicializando RankingManager...');
    window.rankingManager = new RankingManager();
    
    // Refrescar datos cada 5 minutos
    setInterval(() => {
      window.rankingManager.refresh();
    }, 5 * 60 * 1000);
  }
});

// Exportar para uso global
window.RankingManager = RankingManager;
