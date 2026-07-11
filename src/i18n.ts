import { useSyncExternalStore } from 'react'

export type Lang = 'ru' | 'en' | 'es' | 'pt'

export const LANGS: Lang[] = ['ru', 'en', 'es', 'pt']

export const LANG_LABELS: Record<Lang, string> = {
  ru: 'Русский',
  en: 'English',
  es: 'Español',
  pt: 'Português',
}

/**
 * Flat key → string dictionaries. `{n}`-style placeholders are substituted by t().
 * Keys are grouped by screen prefix so unused ones are easy to spot.
 */
const en = {
  'home.quick': 'Quick match',
  'home.quickHint': 'Two players side by side. Starts in seconds.',
  'home.tournament': 'Tournament',
  'home.tournamentHint': 'Bracket for 4 / 8 / 16',
  'home.tournamentResume': 'Resume the current bracket',
  'home.players': 'Players',
  'home.playersSaved': '{n} saved',
  'home.footer': 'Phone is the remote. The show is on the TV.',

  'roster.title': 'Players',
  'roster.placeholder': 'Player name',
  'roster.add': 'Add',
  'roster.empty': 'No players yet. Add the kids once — reuse them every match.',
  'roster.record': '{w} wins · {m} matches',
  'roster.best': 'speed record {n}%',
  'roster.full': 'Roster is full',

  'setup.title': 'New match',
  'setup.guest': 'Guest',
  'setup.player1': 'Player 1',
  'setup.player2': 'Player 2',
  'setup.round': 'Round',
  'setup.seconds': '{n} sec',
  'setup.handicap': 'Head start',
  'setup.mirror': 'TV mirror',
  'setup.sound': 'Sound',
  'setup.camera': 'Camera',
  'setup.cameraN': 'Camera {n}',
  'setup.start': 'START',
  'setup.hint': 'Both players fully visible in frame. Left side is blue, right side is red.',

  'mode.sprint': 'Sprint',
  'mode.fight': 'Duel',
  'mode.marathon': 'Marathon',

  'cal.searching': 'Looking for players',
  'cal.locking': 'Locked — hold still',
  'cal.inFrame': '{n} / 2 in frame',
  'cal.closer': 'Step closer to the camera',
  'cal.apart': 'Spread apart from each other',
  'cal.light': 'Too dark — add some light',

  'hud.winner': 'WINNER',
  'hud.timeUp': 'TIME!',
  'hud.freeze': 'FREEZE!',
  'setup.freeze': 'Freeze!',
  'setup.combo': 'Combo',
  'setup.mode': 'Game mode',
  'setup.mask': 'Masks',

  'gmode.classic': 'Classic',
  'gmode.classicHint': 'First to fill the bar',
  'gmode.rhythm': 'Rhythm',
  'gmode.rhythmHint': 'Move on the beat',
  'gmode.endurance': 'Endurance',
  'gmode.enduranceHint': 'Never stop moving',
  'gmode.traffic': 'Traffic light',
  'gmode.trafficHint': 'Green — go, red — freeze',
  'gmode.boss': 'Boss battle',
  'gmode.bossHint': 'Team up against the boss',

  'hud.overtime': 'OVERTIME!',
  'hud.stop': 'STOP!',
  'hud.go': 'GO!',
  'hud.boss': 'BOSS',

  'cast.tv': 'Show on TV',
  'cast.connecting': 'Connecting…',
  'cast.live': 'TV connected',
  'cast.hint': 'Chromecast or a second window',
  'show.waiting': 'Waiting for the match…',

  'home.session': 'This session: {n} matches',
  'home.sessionLeader': 'leader {name} ({n})',
  'records.title': 'Record book',
  'records.champion': 'Champion',
  'records.fastest': 'Fastest',
  'records.active': 'Most matches',

  'over.winner': 'Winner',
  'over.byTimer': 'Time is up — higher score wins',
  'over.time': 'Match time',
  'over.score': 'Score',
  'over.peak': 'Peak speed',
  'over.avg': 'Avg activity',
  'over.combo': 'Best combo',
  'over.next': 'Next match',
  'over.change': 'Change players',
  'over.home': 'Home',
  'over.continueTour': 'Continue tournament',
  'over.replay': 'Replay match',
  'over.share': 'Share clip',
  'over.clipPreparing': 'Preparing clip…',
  'over.newBelt': 'New belt: {belt}!',

  'belt.white': 'White belt',
  'belt.yellow': 'Yellow belt',
  'belt.orange': 'Orange belt',
  'belt.green': 'Green belt',
  'belt.blue': 'Blue belt',
  'belt.red': 'Red belt',
  'belt.black': 'Black belt',

  'tour.pick': 'Pick the players ({min}–{max})',
  'tour.selected': 'Selected: {n}',
  'tour.start': 'Start tournament',
  'tour.needPlayers': 'Add at least 3 players to the roster first.',
  'tour.toRoster': 'Open players',
  'tour.round': 'Round {n}',
  'tour.final': 'Final',
  'tour.play': 'Play',
  'tour.bye': 'advances',
  'tour.champion': 'Champion',
  'tour.new': 'New tournament',
  'tour.abandon': 'End tournament',

  'load.title': 'Starting camera',
  'load.sub': 'camera · webgl · pose model',
  'err.title': 'Engine error',
  'err.back': 'Back',

  'common.back': 'Back',
  'common.on': 'ON',
  'common.off': 'OFF',
  'common.none': 'None',

  'theme.light': 'Light theme',
  'theme.dark': 'Dark theme',
  'theme.neon': 'Neon theme',
} as const

export type I18nKey = keyof typeof en

type Dict = Record<I18nKey, string>

const ru: Dict = {
  'home.quick': 'Быстрый матч',
  'home.quickHint': 'Двое рядом. Старт за секунды.',
  'home.tournament': 'Турнир',
  'home.tournamentHint': 'Сетка на 4 / 8 / 16',
  'home.tournamentResume': 'Продолжить текущую сетку',
  'home.players': 'Игроки',
  'home.playersSaved': 'Сохранено: {n}',
  'home.footer': 'Телефон — пульт. Игра идёт на ТВ.',

  'roster.title': 'Игроки',
  'roster.placeholder': 'Имя игрока',
  'roster.add': 'Добавить',
  'roster.empty': 'Пока пусто. Добавь детей один раз — используй в каждом матче.',
  'roster.record': 'Побед: {w} · матчей: {m}',
  'roster.best': 'рекорд скорости {n}%',
  'roster.full': 'Ростер заполнен',

  'setup.title': 'Новый матч',
  'setup.guest': 'Гость',
  'setup.player1': 'Игрок 1',
  'setup.player2': 'Игрок 2',
  'setup.round': 'Раунд',
  'setup.seconds': '{n} сек',
  'setup.handicap': 'Фора',
  'setup.mirror': 'ТВ-зеркало',
  'setup.sound': 'Звук',
  'setup.camera': 'Камера',
  'setup.cameraN': 'Камера {n}',
  'setup.start': 'СТАРТ',
  'setup.hint': 'Оба игрока полностью в кадре. Слева — синий, справа — красный.',

  'mode.sprint': 'Спринт',
  'mode.fight': 'Дуэль',
  'mode.marathon': 'Марафон',

  'cal.searching': 'Ищем игроков',
  'cal.locking': 'Есть захват — замрите',
  'cal.inFrame': '{n} / 2 в кадре',
  'cal.closer': 'Подойдите ближе к камере',
  'cal.apart': 'Разойдитесь в стороны',
  'cal.light': 'Слишком темно — добавьте света',

  'hud.winner': 'ПОБЕДИТЕЛЬ',
  'hud.timeUp': 'ВРЕМЯ!',
  'hud.freeze': 'ЗАМРИ!',
  'setup.freeze': 'Замри!',
  'setup.combo': 'Комбо',
  'setup.mode': 'Режим игры',
  'setup.mask': 'Маски',

  'gmode.classic': 'Классика',
  'gmode.classicHint': 'Кто быстрее набьёт шкалу',
  'gmode.rhythm': 'Ритм',
  'gmode.rhythmHint': 'Двигайся в такт битам',
  'gmode.endurance': 'Выносливость',
  'gmode.enduranceHint': 'Не останавливайся ни на секунду',
  'gmode.traffic': 'Светофор',
  'gmode.trafficHint': 'Зелёный — гони, красный — замри',
  'gmode.boss': 'Босс',
  'gmode.bossHint': 'Вдвоём против босса',

  'hud.overtime': 'ОВЕРТАЙМ!',
  'hud.stop': 'СТОП!',
  'hud.go': 'ГОНИ!',
  'hud.boss': 'БОСС',

  'cast.tv': 'Показать на ТВ',
  'cast.connecting': 'Подключение…',
  'cast.live': 'ТВ подключён',
  'cast.hint': 'Chromecast или второе окно',
  'show.waiting': 'Ждём матч…',

  'home.session': 'За эту сессию: {n} матчей',
  'home.sessionLeader': 'лидер {name} ({n})',
  'records.title': 'Книга рекордов',
  'records.champion': 'Чемпион',
  'records.fastest': 'Самый быстрый',
  'records.active': 'Больше всех матчей',

  'over.winner': 'Победитель',
  'over.byTimer': 'Время вышло — побеждает счёт',
  'over.time': 'Время матча',
  'over.score': 'Счёт',
  'over.peak': 'Пиковая скорость',
  'over.avg': 'Средняя активность',
  'over.combo': 'Лучшее комбо',
  'over.next': 'Следующий матч',
  'over.change': 'Сменить игроков',
  'over.home': 'Домой',
  'over.continueTour': 'Продолжить турнир',
  'over.replay': 'Переиграть матч',
  'over.share': 'Поделиться клипом',
  'over.clipPreparing': 'Готовим клип…',
  'over.newBelt': 'Новый пояс: {belt}!',

  'belt.white': 'Белый пояс',
  'belt.yellow': 'Жёлтый пояс',
  'belt.orange': 'Оранжевый пояс',
  'belt.green': 'Зелёный пояс',
  'belt.blue': 'Синий пояс',
  'belt.red': 'Красный пояс',
  'belt.black': 'Чёрный пояс',

  'tour.pick': 'Выбери участников ({min}–{max})',
  'tour.selected': 'Выбрано: {n}',
  'tour.start': 'Начать турнир',
  'tour.needPlayers': 'Сначала добавь хотя бы 3 игроков в ростер.',
  'tour.toRoster': 'К игрокам',
  'tour.round': 'Раунд {n}',
  'tour.final': 'Финал',
  'tour.play': 'Играть',
  'tour.bye': 'проходит дальше',
  'tour.champion': 'Чемпион',
  'tour.new': 'Новый турнир',
  'tour.abandon': 'Завершить турнир',

  'load.title': 'Запускаем камеру',
  'load.sub': 'камера · webgl · модель поз',
  'err.title': 'Ошибка движка',
  'err.back': 'Назад',

  'common.back': 'Назад',
  'common.on': 'ВКЛ',
  'common.off': 'ВЫКЛ',
  'common.none': 'Нет',

  'theme.light': 'Светлая тема',
  'theme.dark': 'Тёмная тема',
  'theme.neon': 'Неоновая тема',
}

const es: Dict = {
  'home.quick': 'Partida rápida',
  'home.quickHint': 'Dos jugadores juntos. Empieza en segundos.',
  'home.tournament': 'Torneo',
  'home.tournamentHint': 'Llaves de 4 / 8 / 16',
  'home.tournamentResume': 'Continuar el torneo actual',
  'home.players': 'Jugadores',
  'home.playersSaved': '{n} guardados',
  'home.footer': 'El móvil es el mando. El show está en la TV.',

  'roster.title': 'Jugadores',
  'roster.placeholder': 'Nombre del jugador',
  'roster.add': 'Añadir',
  'roster.empty': 'Aún no hay jugadores. Añádelos una vez y reutilízalos.',
  'roster.record': '{w} victorias · {m} partidas',
  'roster.best': 'récord de velocidad {n}%',
  'roster.full': 'Lista completa',

  'setup.title': 'Nueva partida',
  'setup.guest': 'Invitado',
  'setup.player1': 'Jugador 1',
  'setup.player2': 'Jugador 2',
  'setup.round': 'Ronda',
  'setup.seconds': '{n} seg',
  'setup.handicap': 'Ventaja',
  'setup.mirror': 'Espejo TV',
  'setup.sound': 'Sonido',
  'setup.camera': 'Cámara',
  'setup.cameraN': 'Cámara {n}',
  'setup.start': 'EMPEZAR',
  'setup.hint': 'Ambos jugadores visibles por completo. Izquierda azul, derecha roja.',

  'mode.sprint': 'Sprint',
  'mode.fight': 'Duelo',
  'mode.marathon': 'Maratón',

  'cal.searching': 'Buscando jugadores',
  'cal.locking': 'Fijados — quietos',
  'cal.inFrame': '{n} / 2 en cuadro',
  'cal.closer': 'Acércate a la cámara',
  'cal.apart': 'Sepárense un poco',
  'cal.light': 'Muy oscuro — enciende una luz',

  'hud.winner': 'GANADOR',
  'hud.timeUp': '¡TIEMPO!',
  'hud.freeze': '¡QUIETO!',
  'setup.freeze': '¡Quieto!',
  'setup.combo': 'Combo',
  'setup.mode': 'Modo de juego',
  'setup.mask': 'Máscaras',

  'gmode.classic': 'Clásico',
  'gmode.classicHint': 'El primero en llenar la barra',
  'gmode.rhythm': 'Ritmo',
  'gmode.rhythmHint': 'Muévete al ritmo',
  'gmode.endurance': 'Resistencia',
  'gmode.enduranceHint': 'No pares ni un segundo',
  'gmode.traffic': 'Semáforo',
  'gmode.trafficHint': 'Verde — corre, rojo — quieto',
  'gmode.boss': 'Jefe',
  'gmode.bossHint': 'En equipo contra el jefe',

  'hud.overtime': '¡PRÓRROGA!',
  'hud.stop': '¡ALTO!',
  'hud.go': '¡DALE!',
  'hud.boss': 'JEFE',

  'cast.tv': 'Mostrar en TV',
  'cast.connecting': 'Conectando…',
  'cast.live': 'TV conectada',
  'cast.hint': 'Chromecast o segunda ventana',
  'show.waiting': 'Esperando la partida…',

  'home.session': 'Esta sesión: {n} partidas',
  'home.sessionLeader': 'líder {name} ({n})',
  'records.title': 'Libro de récords',
  'records.champion': 'Campeón',
  'records.fastest': 'Más rápido',
  'records.active': 'Más partidas',

  'over.winner': 'Ganador',
  'over.byTimer': 'Se acabó el tiempo — gana la puntuación',
  'over.time': 'Duración',
  'over.score': 'Puntuación',
  'over.peak': 'Velocidad máx.',
  'over.avg': 'Actividad media',
  'over.combo': 'Mejor combo',
  'over.next': 'Siguiente partida',
  'over.change': 'Cambiar jugadores',
  'over.home': 'Inicio',
  'over.continueTour': 'Continuar torneo',
  'over.replay': 'Repetir partida',
  'over.share': 'Compartir clip',
  'over.clipPreparing': 'Preparando clip…',
  'over.newBelt': '¡Nuevo cinturón: {belt}!',

  'belt.white': 'Cinturón blanco',
  'belt.yellow': 'Cinturón amarillo',
  'belt.orange': 'Cinturón naranja',
  'belt.green': 'Cinturón verde',
  'belt.blue': 'Cinturón azul',
  'belt.red': 'Cinturón rojo',
  'belt.black': 'Cinturón negro',

  'tour.pick': 'Elige jugadores ({min}–{max})',
  'tour.selected': 'Elegidos: {n}',
  'tour.start': 'Empezar torneo',
  'tour.needPlayers': 'Añade al menos 3 jugadores a la lista.',
  'tour.toRoster': 'Abrir jugadores',
  'tour.round': 'Ronda {n}',
  'tour.final': 'Final',
  'tour.play': 'Jugar',
  'tour.bye': 'avanza',
  'tour.champion': 'Campeón',
  'tour.new': 'Nuevo torneo',
  'tour.abandon': 'Terminar torneo',

  'load.title': 'Iniciando cámara',
  'load.sub': 'cámara · webgl · modelo de poses',
  'err.title': 'Error del motor',
  'err.back': 'Volver',

  'common.back': 'Volver',
  'common.on': 'SÍ',
  'common.off': 'NO',
  'common.none': 'Sin',

  'theme.light': 'Tema claro',
  'theme.dark': 'Tema oscuro',
  'theme.neon': 'Tema neón',
}

const pt: Dict = {
  'home.quick': 'Partida rápida',
  'home.quickHint': 'Dois jogadores lado a lado. Começa em segundos.',
  'home.tournament': 'Torneio',
  'home.tournamentHint': 'Chaves de 4 / 8 / 16',
  'home.tournamentResume': 'Continuar o torneio atual',
  'home.players': 'Jogadores',
  'home.playersSaved': '{n} salvos',
  'home.footer': 'O celular é o controle. O show está na TV.',

  'roster.title': 'Jogadores',
  'roster.placeholder': 'Nome do jogador',
  'roster.add': 'Adicionar',
  'roster.empty': 'Nenhum jogador ainda. Adicione uma vez e reutilize sempre.',
  'roster.record': '{w} vitórias · {m} partidas',
  'roster.best': 'recorde de velocidade {n}%',
  'roster.full': 'Lista cheia',

  'setup.title': 'Nova partida',
  'setup.guest': 'Convidado',
  'setup.player1': 'Jogador 1',
  'setup.player2': 'Jogador 2',
  'setup.round': 'Rodada',
  'setup.seconds': '{n} seg',
  'setup.handicap': 'Vantagem',
  'setup.mirror': 'Espelho TV',
  'setup.sound': 'Som',
  'setup.camera': 'Câmera',
  'setup.cameraN': 'Câmera {n}',
  'setup.start': 'COMEÇAR',
  'setup.hint': 'Ambos os jogadores totalmente visíveis. Esquerda azul, direita vermelha.',

  'mode.sprint': 'Sprint',
  'mode.fight': 'Duelo',
  'mode.marathon': 'Maratona',

  'cal.searching': 'Procurando jogadores',
  'cal.locking': 'Travado — parados',
  'cal.inFrame': '{n} / 2 no quadro',
  'cal.closer': 'Chegue mais perto da câmera',
  'cal.apart': 'Afastem-se um do outro',
  'cal.light': 'Muito escuro — acenda uma luz',

  'hud.winner': 'VENCEDOR',
  'hud.timeUp': 'TEMPO!',
  'hud.freeze': 'ESTÁTUA!',
  'setup.freeze': 'Estátua!',
  'setup.combo': 'Combo',
  'setup.mode': 'Modo de jogo',
  'setup.mask': 'Máscaras',

  'gmode.classic': 'Clássico',
  'gmode.classicHint': 'O primeiro a encher a barra',
  'gmode.rhythm': 'Ritmo',
  'gmode.rhythmHint': 'Mova-se no ritmo',
  'gmode.endurance': 'Resistência',
  'gmode.enduranceHint': 'Não pare nem um segundo',
  'gmode.traffic': 'Semáforo',
  'gmode.trafficHint': 'Verde — corre, vermelho — pára',
  'gmode.boss': 'Chefão',
  'gmode.bossHint': 'Juntos contra o chefão',

  'hud.overtime': 'PRORROGAÇÃO!',
  'hud.stop': 'PARA!',
  'hud.go': 'VAI!',
  'hud.boss': 'CHEFÃO',

  'cast.tv': 'Mostrar na TV',
  'cast.connecting': 'Conectando…',
  'cast.live': 'TV conectada',
  'cast.hint': 'Chromecast ou segunda janela',
  'show.waiting': 'À espera da partida…',

  'home.session': 'Esta sessão: {n} partidas',
  'home.sessionLeader': 'líder {name} ({n})',
  'records.title': 'Livro de recordes',
  'records.champion': 'Campeão',
  'records.fastest': 'Mais rápido',
  'records.active': 'Mais partidas',

  'over.winner': 'Vencedor',
  'over.byTimer': 'Tempo esgotado — vence a pontuação',
  'over.time': 'Duração',
  'over.score': 'Pontuação',
  'over.peak': 'Velocidade máx.',
  'over.avg': 'Atividade média',
  'over.combo': 'Melhor combo',
  'over.next': 'Próxima partida',
  'over.change': 'Trocar jogadores',
  'over.home': 'Início',
  'over.continueTour': 'Continuar torneio',
  'over.replay': 'Repetir partida',
  'over.share': 'Compartilhar clipe',
  'over.clipPreparing': 'Preparando clipe…',
  'over.newBelt': 'Nova faixa: {belt}!',

  'belt.white': 'Faixa branca',
  'belt.yellow': 'Faixa amarela',
  'belt.orange': 'Faixa laranja',
  'belt.green': 'Faixa verde',
  'belt.blue': 'Faixa azul',
  'belt.red': 'Faixa vermelha',
  'belt.black': 'Faixa preta',

  'tour.pick': 'Escolha os jogadores ({min}–{max})',
  'tour.selected': 'Escolhidos: {n}',
  'tour.start': 'Começar torneio',
  'tour.needPlayers': 'Adicione pelo menos 3 jogadores à lista.',
  'tour.toRoster': 'Abrir jogadores',
  'tour.round': 'Rodada {n}',
  'tour.final': 'Final',
  'tour.play': 'Jogar',
  'tour.bye': 'avança',
  'tour.champion': 'Campeão',
  'tour.new': 'Novo torneio',
  'tour.abandon': 'Encerrar torneio',

  'load.title': 'Iniciando câmera',
  'load.sub': 'câmera · webgl · modelo de poses',
  'err.title': 'Erro do motor',
  'err.back': 'Voltar',

  'common.back': 'Voltar',
  'common.on': 'SIM',
  'common.off': 'NÃO',
  'common.none': 'Sem',

  'theme.light': 'Tema claro',
  'theme.dark': 'Tema escuro',
  'theme.neon': 'Tema néon',
}

const DICTS: Record<Lang, Dict> = { en, ru, es, pt }

const LANG_STORAGE_KEY = 'sb.lang'

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    if (saved && LANGS.includes(saved as Lang)) return saved as Lang
  } catch {
    /* storage unavailable */
  }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return LANGS.includes(nav as Lang) ? (nav as Lang) : 'en'
}

let currentLang: Lang = detectLang()
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return currentLang
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn())
}

/** Translate a key with optional {placeholder} substitution. Usable outside React (canvas). */
export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let text = DICTS[currentLang][key] ?? en[key] ?? key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(`{${name}}`, String(value))
    }
  }
  return text
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React binding: re-renders the component when the language changes. */
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getLang)
  return { lang, t, setLang }
}
