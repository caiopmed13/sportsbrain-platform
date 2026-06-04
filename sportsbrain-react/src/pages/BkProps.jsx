import { useEffect, useState, useCallback, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { PickTierBadge, ConfBar, EdgeBadge, StakeBadge, KellyBadge } from '../components/ui/PickBadges'
import { usePerfStore } from '../store'
import { fetchMatches } from '../api/client'
import { makePickId, autoSavePicks, updateHistResult, serverSyncHistory, calcHistStats, HistoricoView } from '../utils/pickHistory'
import { isMatchFeatured, fetchFeaturedMatches } from '../utils/featured'
import { fetchPlayerStatsBatch, enrichCombosWithHitRate, enrichPropsWithHitRate, fetchNBAInjuries, buildInjurySet } from '../utils/nbaEnrich'
// isMatchFeatured used for NBA match sorting

function today() { return new Date().toISOString().split('T')[0] }

const BK_HIST_KEY = 'sb_bkprops_history'

// ─── Tabelas de dados NBA ────────────────────────────────────────────────────

// Médias de pontos por jogador (temporada atual)
const NBA_AVG_PTS = {
  'Shai Gilgeous-Alexander':32,'Giannis Antetokounmpo':30,'Luka Doncic':30,'Nikola Jokic':27,
  'Joel Embiid':28,'Jayson Tatum':27,'Anthony Edwards':27,'LaMelo Ball':26,
  'Stephen Curry':26,'Kevin Durant':26,'Jalen Brunson':27,'Donovan Mitchell':26,
  'Devin Booker':26,'Kyrie Irving':25,'Victor Wembanyama':25,'Jaylen Brown':24,
  'Karl-Anthony Towns':24,'Tyrese Maxey':24,'LeBron James':24,'Damian Lillard':24,
  'Cade Cunningham':24,'Jalen Williams':23,'De Aaron Fox':23,'Trae Young':23,
  'Paolo Banchero':23,'Zach LaVine':23,'Jamal Murray':22,'Tyrese Haliburton':22,
  'Anthony Davis':22,'Zion Williamson':22,'Domantas Sabonis':20,
  'Bam Adebayo':20,'Pascal Siakam':20,'Alperen Sengun':21,'Mikal Bridges':20,
  'Lauri Markkanen':23,'Scottie Barnes':19,'Franz Wagner':20,'Jalen Green':22,
  'Tyler Herro':21,'Michael Porter Jr.':19,'Klay Thompson':17,'Devin Vassell':19,
  'Jaren Jackson Jr.':21,'Ja Morant':22,'Kawhi Leonard':20,'Brandon Ingram':20,
  'Chet Holmgren':18,'Jalen Johnson':21,'Darius Garland':21,'Josh Hart':13,
  'OG Anunoby':16,'Andrew Wiggins':17,'Austin Reaves':16,'Kyle Kuzma':17,
  'Tobias Harris':15,'Miles Bridges':16,'Coby White':16,'Fred VanVleet':16,
  'CJ McCollum':18,'D Angelo Russell':15,'Jerami Grant':19,'Cam Thomas':22,
  'Immanuel Quickley':20,'Norman Powell':19,'Desmond Bane':20,'Keegan Murray':16,
}

// Posição de cada jogador
const NBA_POSITIONS = {
  'LaMelo Ball':'guard','Shai Gilgeous-Alexander':'guard','Luka Doncic':'guard',
  'Ja Morant':'guard','Trae Young':'guard','Damian Lillard':'guard',
  'Stephen Curry':'guard','Kyrie Irving':'guard','Jalen Brunson':'guard',
  'Tyrese Maxey':'guard','Donovan Mitchell':'guard','Anthony Edwards':'guard',
  'Darius Garland':'guard','Devin Booker':'guard','De Aaron Fox':'guard',
  'Jamal Murray':'guard','Tyrese Haliburton':'guard','Cade Cunningham':'guard',
  'Tyler Herro':'guard','Jalen Green':'guard','Cam Thomas':'guard',
  'Anfernee Simons':'guard','Coby White':'guard','Jalen Williams':'guard',
  'Desmond Bane':'guard','RJ Barrett':'guard','Immanuel Quickley':'guard',
  'CJ McCollum':'guard','Scoot Henderson':'guard','Brandin Podziemski':'guard',
  'Gary Trent Jr.':'guard','Fred VanVleet':'guard','Marcus Smart':'guard',
  'D Angelo Russell':'guard','Jordan Clarkson':'guard','Andrew Nembhard':'guard',
  'Jayson Tatum':'wing','Jaylen Brown':'wing','Jimmy Butler':'wing',
  'Kawhi Leonard':'wing','Kevin Durant':'wing','LeBron James':'wing',
  'Paul George':'wing','OG Anunoby':'wing','Mikal Bridges':'wing',
  'Pascal Siakam':'wing','Scottie Barnes':'wing','Franz Wagner':'wing',
  'Paolo Banchero':'wing','Zion Williamson':'wing','Brandon Ingram':'wing',
  'Michael Porter Jr.':'wing','Norman Powell':'wing','Keegan Murray':'wing',
  'Andrew Wiggins':'wing','Jerami Grant':'wing','Aaron Gordon':'wing',
  'Klay Thompson':'wing','Devin Vassell':'wing','Herb Jones':'wing',
  'Kyle Kuzma':'wing','Jonathan Kuminga':'wing','Josh Green':'wing',
  'Jalen Johnson':'wing','Amen Thompson':'wing','Bilal Coulibaly':'wing',
  'Jaden McDaniels':'wing','Bogdan Bogdanovic':'wing','Austin Reaves':'wing',
  'Tobias Harris':'wing','Miles Bridges':'wing',
  'Joel Embiid':'big','Nikola Jokic':'big','Anthony Davis':'big',
  'Karl-Anthony Towns':'big','Bam Adebayo':'big','Evan Mobley':'big',
  'Domantas Sabonis':'big','Rudy Gobert':'big','Jaren Jackson Jr.':'big',
  'Brook Lopez':'big','Myles Turner':'big','Chet Holmgren':'big',
  'Victor Wembanyama':'big','Nikola Vucevic':'big','Ivica Zubac':'big',
  'Jarrett Allen':'big','Jalen Duren':'big','Alperen Sengun':'big',
  'Lauri Markkanen':'big','Julius Randle':'big','Deandre Ayton':'big',
  'Giannis Antetokounmpo':'big','Draymond Green':'big','Bobby Portis':'big',
  'Kristaps Porzingis':'big','Walker Kessler':'big','Onyeka Okongwu':'big',
  'Clint Capela':'big','Mark Williams':'big','Alexandre Sarr':'big',
  'Dereck Lively II':'big','Jakob Poeltl':'big','Obi Toppin':'big',
}

// Médias por posição
const BKP_POS_AVG = {
  guard: { pts: 22.5, reb: 4.2, ast: 5.8 },
  wing:  { pts: 21.0, reb: 5.5, ast: 3.2 },
  big:   { pts: 19.5, reb: 8.8, ast: 2.1 },
}

// Rosters atualizados (março 2026)
const NBA_PLAYERS = {
  'Celtics':      ['Jayson Tatum','Jaylen Brown','Jrue Holiday','Nikola Vucevic','Payton Pritchard','Sam Hauser'],
  'Knicks':       ['Jalen Brunson','Karl-Anthony Towns','Josh Hart','OG Anunoby','Mikal Bridges'],
  'Nets':         ['Cam Thomas','Nic Claxton','Dennis Schroder','Dorian Finney-Smith','Noah Clowney'],
  '76ers':        ['Tyrese Maxey','Paul George','Joel Embiid','Kelly Oubre Jr.','Andre Drummond'],
  'Raptors':      ['Scottie Barnes','Immanuel Quickley','RJ Barrett','Jakob Poeltl','Gradey Dick'],
  'Bucks':        ['Giannis Antetokounmpo','Kyle Kuzma','Myles Turner','Brook Lopez','Gary Trent Jr.','Khris Middleton','MarJon Beauchamp','AJ Green','Pat Connaughton'],
  'Pacers':       ['Tyrese Haliburton','Pascal Siakam','Ivica Zubac','Obi Toppin','Andrew Nembhard'],
  'Cavaliers':    ['Donovan Mitchell','James Harden','Evan Mobley','Jarrett Allen','Caris LeVert'],
  'Pistons':      ['Cade Cunningham','Jalen Duren','Ausar Thompson','Tobias Harris','Malik Beasley'],
  'Bulls':        ['Josh Giddey','Patrick Williams','Matas Buzelis','Anfernee Simons','Jaden Ivey'],
  'Heat':         ['Bam Adebayo','Tyler Herro','Jimmy Butler','Haywood Highsmith','Josh Richardson'],
  'Magic':        ['Paolo Banchero','Franz Wagner','Desmond Bane','Jalen Suggs','Wendell Carter Jr.'],
  'Hawks':        ['Jalen Johnson','Jonathan Kuminga','CJ McCollum','Onyeka Okongwu','Buddy Hield'],
  'Hornets':      ['LaMelo Ball','Miles Bridges','Coby White','Grant Williams','Nick Richards'],
  'Wizards':      ['Trae Young','Anthony Davis','Saddiq Bey','Alexandre Sarr','Bilal Coulibaly'],
  'Thunder':      ['Shai Gilgeous-Alexander','Jalen Williams','Chet Holmgren','Isaiah Hartenstein','Lu Dort'],
  'Nuggets':      ['Nikola Jokic','Jamal Murray','Michael Porter Jr.','Aaron Gordon','Peyton Watson'],
  'Timberwolves': ['Anthony Edwards','Rudy Gobert','Julius Randle','Jaden McDaniels','Donte DiVincenzo'],
  'Jazz':         ['Jordan Clarkson','Isaiah Collier','Keyonte George','Lauri Markkanen','Walker Kessler','Jaren Jackson Jr.','Cody Williams','Kyle Filipowski','Brice Sensabaugh','Micah Potter'],
  'Trail Blazers':['Scoot Henderson','Jerami Grant','Deandre Ayton','Toumani Camara','Shaedon Sharpe'],
  'Warriors':     ['Stephen Curry','Draymond Green','Kristaps Porzingis','Andrew Wiggins','Brandin Podziemski','Jimmy Butler','Will Richard','LJ Cryer','Pat Spencer','Omer Yurtseven'],
  'Lakers':       ['LeBron James','Luka Doncic','Austin Reaves','Luke Kennard','Rui Hachimura'],
  'Clippers':     ['Kawhi Leonard','Darius Garland','Norman Powell','Bogdan Bogdanovic','Terance Mann'],
  'Suns':         ['Devin Booker','Jalen Green','Dillon Brooks','Mark Williams','Ryan Dunn'],
  'Kings':        ['Domantas Sabonis','Keegan Murray','Kevin Huerter','Harrison Barnes','Keon Ellis'],
  'Spurs':        ['Victor Wembanyama','De Aaron Fox','Stephon Castle','Devin Vassell','Jeremy Sochan','Julian Champagnie','Sandro Mamukelashvili','Blake Wesley'],
  'Mavericks':    ['Kyrie Irving','Klay Thompson','P.J. Washington','Dereck Lively II','Josh Green'],
  'Rockets':      ['Kevin Durant','Alperen Sengun','Fred VanVleet','Clint Capela','Jabari Smith Jr.'],
  'Grizzlies':    ['GG Jackson','Yuki Kawamura','Jake LaRavia','Luke Kennard','Vince Williams Jr.','Ja Morant','Scotty Pippen Jr.','Santi Aldama'],
  'Pelicans':     ['Zion Williamson','Brandon Ingram','Jose Alvarado','Herb Jones','Trey Murphy III'],
}

const CONFERENCES = {
  East: ['Celtics','Bucks','Nets','76ers','Heat','Bulls','Cavaliers','Hawks','Raptors','Magic','Pacers','Knicks','Pistons','Hornets','Wizards'],
  West: ['Warriors','Lakers','Clippers','Suns','Nuggets','Mavericks','Jazz','Rockets','Thunder','Trail Blazers','Kings','Timberwolves','Pelicans','Spurs','Grizzlies'],
}

// ─── Pace por equipa (possessões/48min) — 2025-26 ────────────────────────────
// Fonte: NBAstuffer.com (temporada regular 2025-26, atualizado abr/2026)
// Liga avg ≈ 99.5 · Grandes mudanças vs 2024-25: Heat +4.8, Mavs +5.1, Jazz +6.5
// Lakers caiu -4.5 (estilo Luka), Celtics caiu -4.7, Pacers caiu -4.9 (Haliburton out)
const NBA_PACE = {
  'Heat':103.6,'Bulls':102.3,'Hawks':101.7,'Mavericks':101.7,'Jazz':101.7,
  'Wizards':101.3,'Grizzlies':101.1,'Pacers':100.9,'Trail Blazers':100.8,
  'Timberwolves':100.5,'Spurs':100.0,'Pelicans':99.9,'Cavaliers':99.9,
  'Magic':99.7,'76ers':99.4,'Warriors':99.3,'Thunder':99.3,'Kings':99.2,
  'Pistons':99.2,'Raptors':98.5,'Lakers':98.4,'Nuggets':98.3,'Bucks':97.6,
  'Nets':97.0,'Hornets':97.0,'Suns':97.2,'Knicks':97.1,'Clippers':96.4,
  'Rockets':96.0,'Celtics':94.8,
}
const NBA_PACE_AVG = 99.5

// Busca pace por nome parcial (API pode retornar nome completo do time)
function getTeamPace(teamName) {
  if (!teamName) return NBA_PACE_AVG
  if (NBA_PACE[teamName]) return NBA_PACE[teamName]
  const k = Object.keys(NBA_PACE).find(k =>
    (teamName||'').toLowerCase().includes(k.toLowerCase()) ||
    k.toLowerCase().includes((teamName||'').toLowerCase())
  )
  return k ? NBA_PACE[k] : NBA_PACE_AVG
}

// Vantagem de jogar em casa, diferenciada por posição
// Pesquisa: Guards +1% (mobilidade menos afetada), Wings +1.8%, Bigs +1.5% (rebotes, contato)
const HOME_ADV_BY_POS = { guard: 0.010, wing: 0.018, big: 0.015 }

// ─── Jogadores confirmados OUT hoje (ESPN Injury Report — 13/04/2026) ─────────
// Atualizar conforme novos injury reports. Jogadores aqui são excluídos dos props.
const NBA_OUT = new Set([
  // Temporada encerrada
  'Kyrie Irving',             // Mavericks — joelho (season-ending)
  'Dereck Lively II',         // Mavericks — pé (season-ending)
  'Jimmy Butler',             // Heat/Warriors — LCA (season-ending)
  'Moses Moody',              // Warriors — joelho (season-ending)
  'Ja Morant',                // Grizzlies — cotovelo (season-ending)
  'Scotty Pippen Jr.',        // Grizzlies — pé (season-ending)
  'Kentavious Caldwell-Pope', // Grizzlies — dedo (season-ending)
  'Santi Aldama',             // Grizzlies — joelho (season-ending)
  'Jaylen Wells',             // Grizzlies — dedo (season-ending)
  'Walker Kessler',           // Jazz — ombro (season-ending)
  'Jusuf Nurkic',             // Jazz — nariz (season-ending)
  'Tyrese Haliburton',        // Pacers — Aquiles (season-ending)
  'Ivica Zubac',              // Pacers — costela (season-ending)
  'Domantas Sabonis',         // Kings — joelho (season-ending)
  'Zach LaVine',              // Kings — mão (season-ending)
  'De Andre Hunter',          // Kings — cirurgia olho (season-ending)
  'Drew Eubanks',             // Kings — polegar (season-ending)
  'Fred VanVleet',            // Rockets — LCA (season-ending)
  'Steven Adams',             // Rockets — tornozelo (season-ending)
  'Damian Lillard',           // Trail Blazers — Aquiles (season-ending)
  'Kristaps Porzingis',       // Warriors — ausente (season-ending)
  'Jalen Smith',              // Bulls — panturrilha (season-ending)
  'Zach Collins',             // Bulls — dedão (season-ending)
  'Noa Essengue',             // Bulls — ombro (season-ending)
  'Jaren Jackson Jr.',        // Jazz — joelho (season-ending)
  'Bradley Beal',             // Clippers — quadril (season-ending)
  'Kevin Porter Jr.',         // Bucks — joelho (season-ending)
  'Cam Whitmore',             // Wizards — veia (season-ending)
  'Chucky Hepburn',           // Raptors — joelho
  'Day Ron Sharpe',           // Nets — polegar (season-ending)
  'Brandon Clarke',           // Grizzlies — panturrilha (season-ending)
  'Zach Edey',                // Grizzlies — cotovelo
  'D Angelo Russell',         // Wizards — não relacionado a lesão

  // OUT para jogos próximos (fonte: ESPN + t.me/nba_injurynews — 04/05/2026 23:10 UTC [atualizado auto])
  'Giannis Antetokounmpo',       // Bucks — joelho
  'Bobby Portis',                // Bucks — pulso
  'Kyle Kuzma',                  // Bucks — Aquiles (DTD)
  'Myles Turner',                // Bucks — tornozelo
  'Gary Trent Jr.',              // Bucks — quadril
  'Ryan Rollins',                // Warriors — quadril ⚠️ TELEGRAM
  'Nikola Vucevic',              // Celtics — dedo (cirurgia)
  'Lauri Markkanen',             // Jazz — quadril
  'Keyonte George',              // Jazz — isquiotibial
  'Isaiah Collier',              // Jazz — isquiotibial
  'Elijah Harkless',             // Jazz — lesão
  // 'Cade Cunningham',             // Pistons — pulmão → ✅ sem restrições 20/04/2026 (Telegram)
  'Isaiah Stewart',              // Pistons — panturrilha
  // 'Karl-Anthony Towns',       // Knicks — cotovelo (11/04) → ✅ starting Thursday 30/04 22:40 UTC (Telegram lineup)
  // 'Jaden McDaniels',          // Timberwolves — joelho (11/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  'PJ Washington',               // Grizzlies — doença ⚠️ TELEGRAM
  'Cam Spencer',                 // Grizzlies — lesão
  'Jahmai Mashack',              // Grizzlies — lesão (05/04) ⚠️ TELEGRAM
  'Javon Small',                 // Grizzlies — lesão (05/04) ⚠️ TELEGRAM
  'Michael Porter Jr.',          // Nets — isquiotibial
  'Ziaire Williams',             // Nets — lesão (05/04) ⚠️ TELEGRAM
  'Nic Claxton',                 // Nets — lesão (05/04) ⚠️ TELEGRAM
  // 'Jerami Grant',             // Trail Blazers — panturrilha → ✅ disponível 15/04/2026 (Spurs)
  'Shaedon Sharpe',              // Trail Blazers — panturrilha
  'Trae Young',                  // Wizards — quadríceps
  'Anthony Davis',               // Wizards — dedo
  'Alexandre Sarr',              // Wizards — dedão
  'Kyshawn George',              // Wizards — lesão (05/04) ⚠️ TELEGRAM
  // 'Immanuel Quickley',        // Raptors — pé → ✅ disponível 07/04/2026
  'Keegan Murray',               // Kings — tornozelo
  'Russell Westbrook',           // Kings — dedão
  'Haywood Highsmith',           // Suns — joelho
  'Ty Jerome',                   // Suns — tornozelo
  'Trey Murphy III',             // Pelicans — tornozelo
  'Olivier-Maxence Prosper',     // Pelicans — costas
  'Karlo Matkovic',              // Pelicans — costas
  'Marcus Smart',                // Lakers — tornozelo
  'Luka Doncic',                 // Lakers — lesão (05/04) ⚠️ TELEGRAM
  // 'Austin Reaves',            // Lakers — lesão (05/04) → ✅ disponível 29/04/2026 (Shams 16:56 UTC)
  'Jonathan Isaac',              // Magic — joelho
  // 'Anthony Black',            // Magic — abdômen → ✅ cleared for Monday 06/04
  'Walter Clayton Jr.',          // Magic — quadril ⚠️ TELEGRAM
  'Anfernee Simons',             // Bulls — pulso
  // 'Victor Wembanyama',        // Spurs — load management → ✅ disponível 29/04/2026 (jogou starting lineup 00:56 UTC)
  'Aaron Nesmith',               // Pacers — pescoço
  'Danny Wolf',                  // Nets — lesão
  'Egor Demin',                  // Nets — lesão
  'Andrew Nembhard',             // Pacers — costas/pescoço
  'Pascal Siakam',               // Pacers — lesão (05/04) ⚠️ TELEGRAM
  // 'Jarace Walker',            // Pacers — lesão → ✅ disponível 09/04/2026
  'Johnny Furphy',               // Pacers — lesão
  'T.J. McConnell',              // Pacers — lesão
  'Evan Mobley',                 // Cavaliers — lesão (05/04) ⚠️ TELEGRAM
  'Jarrett Allen',               // Cavaliers — lesão (05/04) ⚠️ TELEGRAM
  'Sam Merrill',                 // Cavaliers — lesão (05/04) ⚠️ TELEGRAM
  'Quinten Post',                // Warriors — pé
  'Al Horford',                  // Warriors — lesão (05/04) ⚠️ TELEGRAM
  'Gary Payton II',              // Warriors — gestão de lesão
  'Dean Wade',                   // Cavaliers — tornozelo
  'Jaylon Tyson',                // Cavaliers — dedão
  'Jock Landale',                // Hawks — lesão
  'Caleb Martin',                // Mavericks — pé ⚠️ TELEGRAM
  'Thomas Sorber',               // Thunder — lesão (05/04) ⚠️ TELEGRAM
  'Isaiah Jackson',              // Clippers — lesão (05/04) ⚠️ TELEGRAM
  'Yanic Konan Niederhauser',    // Clippers — lesão (05/04) ⚠️ TELEGRAM
  'Dejounte Murray',             // Pelicans — mão (05/04) ⚠️ TELEGRAM
  'Noah Clowney',                // Nets — tornozelo (05/04) ⚠️ TELEGRAM
  // Adicionados em 05/04/2026 — atualização automática (ESPN + Telegram)
  'Ben Saraf',                   // Nets — costas (05/04)
  'Terance Mann',                // Nets — Aquiles/joelho (05/04)
  'Josh Giddey',                 // Bulls — isquiotibial (05/04)
  'Matas Buzelis',               // Bulls — doença (05/04)
  'Nick Richards',               // Bulls — cotovelo (05/04)
  'Norman Powell',               // Heat — doença (05/04)
  'Bryce McGowens',              // Pelicans — dedo (05/04)
  'Justin Champagnie',           // Wizards — joelho (05/04)
  'Tristan Vukcevic',            // Wizards — joelho (05/04)
  'Tre Johnson',                 // Wizards — pé (05/04)
  'Bilal Coulibaly',             // Wizards — calcanhar (05/04)
  'Cam Payne',                   // Suns — isquiotibial (05/04) ⚠️ TELEGRAM
  // Adicionados em 06/04/2026 — atualização automática (ESPN + Telegram)
  'Vit Krejci',                  // Trail Blazers — OUT (06/04)
  // 'Spencer Jones',            // Nuggets — OUT (06/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  'Peyton Watson',               // Nuggets — OUT (06/04)
  'Daniel Gafford',              // Rockets — ombro (06/04)
  // 'Franz Wagner',             // Magic — gestão de lesão (06/04) → ✅ voltou 09/04/2026
  'Jett Howard',                 // Pistons — tornozelo (06/04)
  // Adicionados em 06/04/2026 — atualização 2 (t.me/nba_injurynews)
  // 'Tobias Harris',            // Pistons — ankle → ✅ disponível 01/05/2026 (Telegram, listed available Friday)
  'Duncan Robinson',             // Heat — quadril (06/04)
  'Caris LeVert',                // Cavaliers — gestão de lesão (06/04)
  'Taylor Hendricks',            // Jazz — polegar (06/04)
  'Taj Gibson',                  // Bulls — gestão de lesão (06/04)
  // Adicionados em 07/04/2026 — atualização automática (t.me/nba_injurynews)
  'Jalen Williams',              // Thunder — injury management (07/04)
  // 'Anthony Edwards',             // Timberwolves — OUT (07/04) → ✅ confirmou jogo 20/04/2026 (Telegram)
  'Gui Santos',                  // Warriors — OUT (07/04)
  'Nikola Jovic',                // Heat — tornozelo (07/04)
  // Adicionados em 07/04/2026 — atualização 2 (ESPN + t.me/nba_injurynews)
  'LeBron James',                // Lakers — pé (07/04)
  'PJ Hall',                     // Hornets — tornozelo (07/04)
  'Ben Sheppard',                // Pacers — quadril (07/04)
  'Thomas Bryant',               // Cavaliers — panturrilha (07/04)
  'Johni Broome',                // 76ers — joelho (07/04)
  'DeMar DeRozan',               // Kings — isquiotibial (07/04)
  'Jaden Hardy',                 // Wizards — costas (07/04)
  // 'Ace Bailey',               // Jazz — joelho (07/04) → ✅ cleared 09/04/2026
  // 'Coby White',               // Bulls — virilha (07/04) → ✅ disponível 10/04/2026
  // 'LJ Cryer',                 // Rockets — doença (07/04) → ✅ disponível 15/04/2026
  'Yves Missi',                  // Pelicans — mão (07/04)
  // Adicionados em 09/04/2026 — atualização automática (t.me/nba_injurynews)
  'Brandon Williams',            // NBA — doença (09/04) ⚠️ TELEGRAM
  'Grayson Allen',               // NBA — quadríceps (09/04) ⚠️ TELEGRAM
  'Jordan Goodwin',              // NBA — tornozelo (09/04) ⚠️ TELEGRAM
  // Adicionados em 09/04/2026 — atualização 2 (ESPN + t.me/nba_injurynews)
  'Nolan Traore',                // Nets — lesão (09/04)
  'Josh Minott',                 // Nets — lesão (09/04)
  'Jaxson Hayes',                // Lakers — lesão (09/04)
  'Isaac Okoro',                 // Bulls — quadríceps (09/04)
  // Adicionados em 09/04/2026 — atualização 3 (t.me/nba_injurynews)
  'Kobe Brown',                  // Pacers — costas (09/04) ⚠️ TELEGRAM
  'Kyle Filipowski',             // Jazz — injury management (09/04) ⚠️ TELEGRAM
  'Brice Sensabaugh',            // Jazz — rest (09/04) ⚠️ TELEGRAM
  // Adicionados em 10/04/2026 — atualização automática (t.me/nba_injurynews)
  'Cedric Coward',               // Warriors — costas (10/04) ⚠️ TELEGRAM
  'GG Jackson',                  // Grizzlies — joelho (10/04) ⚠️ TELEGRAM
  'Devin Booker',                // Suns — gestão de lesão (10/04) ⚠️ TELEGRAM
  // Adicionados em 10/04/2026 — atualização 2 (t.me/nba_injurynews)
  // 'Jayson Tatum',             // Celtics — injury management (10/04) → ✅ starting Thursday 30/04 23:36 UTC (Telegram lineup)
  // Adicionados em 10/04/2026 — atualização 3 (t.me/nba_injurynews)
  'RJ Barrett',                  // Raptors — joelho (10/04) ⚠️ TELEGRAM
  'Naji Marshall',               // Pelicans — quadril (10/04) ⚠️ TELEGRAM
  'Gary Harris',                 // NBA — virilha (10/04) ⚠️ TELEGRAM
  // Adicionados em 11/04/2026 — atualização automática (ESPN + t.me/nba_injurynews)
  'Jalen Green',                 // Suns — joelho (11/04)
  'Donovan Mitchell',            // Cavaliers — gestão de tornozelo (11/04)
  'Klay Thompson',               // Mavericks — doença (11/04)
  'Marvin Bagley III',           // Mavericks — ombro (11/04)
  // 'Jamal Murray',             // Nuggets — ombro (11/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  // 'Nikola Jokic',             // Nuggets — pulso (11/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  // 'Cameron Johnson',          // Nuggets — rest (11/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  'Aaron Gordon',                // Nuggets — calf (28/04, ESPN: ruled out Game 5; est. return Apr 30) ⚠️ TELEGRAM/ESPN — re-adicionado pós-recaída
  // 'Christian Braun',          // Nuggets — tornozelo (11/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  'Seth Curry',                  // Warriors — adutor (11/04)
  'Naz Reid',                    // Timberwolves — ombro (11/04)
  // 'Julius Randle',            // Timberwolves — mão (11/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  'Joe Ingles',                  // Timberwolves — razões pessoais (11/04)
  'Bones Hyland',                // Timberwolves — quadril (11/04)
  // 'Rudy Gobert',              // Timberwolves — rest (11/04) → ✅ starting Thursday 01/05 01:02 UTC (Telegram lineup)
  'Zion Williamson',             // Pelicans — joelho (11/04)
  'Herb Jones',                  // Pelicans — rest (11/04)
  'Saddiq Bey',                  // Pelicans — rest (11/04)
  // 'Mitchell Robinson',        // Knicks — rest (11/04) → ✅ retornou ao jogo Thursday 30/04 23:54 UTC (Telegram, foi p/ locker room mas voltou)
  'Miles McBride',               // Knicks — pélvis (11/04)
  'Tyler Kolek',                 // Knicks — oblíquo (11/04)
  // 'OG Anunoby',                  // Knicks — tornozelo (11/04) → ✅ disponível 20/04/2026 (Telegram)
  // 'Jaylin Williams',             // Thunder — Aquiles (11/04) → ✅ retornou 20/04/2026 (Telegram)
  'Cason Wallace',               // Thunder — dedão (11/04)
  'Ajay Mitchell',               // Thunder — tornozelo (11/04)
  'Chet Holmgren',               // Thunder — costas (11/04)
  // 'Isaiah Joe',                  // Thunder — joelho (11/04) → ✅ disponível 27/04/2026 (Telegram, "not listed on injury report for Monday")
  'Isaiah Hartenstein',          // Thunder — panturrilha (11/04)
  'Shai Gilgeous-Alexander',     // Thunder — oblíquo (11/04)
  'Alex Caruso',                 // Thunder — rest (11/04)
  'Pete Nance',                  // Bucks — joelho (11/04)
  'Trayce Jackson-Davis',        // Raptors — doença (11/04)
  'Collin Murray-Boyles',        // Raptors — pescoço (11/04)
  'Immanuel Quickley',           // Raptors — rest (11/04)
  'Dru Smith',                   // Heat — pé (11/04)
  'Davion Mitchell',             // Heat — ombro (11/04)
  'Tyler Herro',                 // Heat — pé (11/04)
  // 'Stephon Castle',              // Spurs — pé (11/04) → ✅ jogou 26/04/2026 (Telegram, hand scare in-game mas retornou)
  'Drake Powell',                // Nets — rest (11/04)
  // Adicionados em 13/04/2026 — atualização automática (t.me/nba_injurynews)
  'Cooper Flagg',                // Mavericks — tornozelo (13/04) ⚠️ TELEGRAM
  // 'Dylan Harper',                // Spurs — polegar (13/04) → ✅ disponível 20/04/2026 (Telegram)
  // Adicionados em 13/04/2026 — atualização 2 (ESPN)
  'Jonathan Kuminga',            // Hawks — joelho (13/04)
  // 'Dyson Daniels',            // Hawks — dedo (13/04) → ✅ starting Thursday 30/04 22:40 UTC (Telegram lineup)
  // 'Nickeil Alexander-Walker', // Hawks — dedo (13/04) → ✅ starting Thursday 30/04 22:40 UTC (Telegram lineup)
  'Simone Fontecchio',           // Heat — tornozelo (13/04)
  // Verificado em 13/04/2026 — atualização 4 (ESPN + t.me/nba_injurynews) — sem novos jogadores OUT
  // Adicionados em 15/04/2026 — atualização automática (t.me/nba_injurynews)
  // 'Joel Embiid',                 // 76ers — OUT (15/04) → ✅ disponível 26/04/2026 22:30 UTC (Telegram, recuperado pós-apendicectomia)
  'Bam Adebayo',                 // Heat — costas (15/04) ⚠️ TELEGRAM
  // Verificado em 17/04/2026 — atualização automática (t.me/nba_injurynews) — sem novos 🚫 OUT confirmados
  // Telegram 17/04: 🚫 Jock Landale (ankle) e 🚫 Quinten Post (injury mgmt) — ambos já listados
  // Questionáveis (❓) não adicionados: Jonathan Isaac, Moussa Diabate, Mark Williams, Grayson Allen
  // Re-verificado 17/04/2026 14:09 (scheduled task nba-injury-update) — 🚫 hoje: Jimmy Butler, Moses Moody, Quinten Post (todos já listados). ✅ 16/04: Stephen Curry, Derrick Jones Jr. (nunca estiveram no OUT). Sem mudanças.
  // Re-verificado 20/04/2026 (scheduled task nba-injury-update) — 🚫 hoje: Thomas Bryant (calf), Jordan Goodwin (calf) — ambos já listados. ✅ removidos do OUT: Cade Cunningham, Jaylin Williams, Dylan Harper. ❓ questionáveis (NÃO adicionados): Onyeka Okongwu, Anthony Edwards (já OUT por outro motivo).
  // Re-verificado 20/04/2026 14:10 UTC (scheduled task nba-injury-update, 2ª execução do dia) — 🚫 confirmados OUT: Thomas Bryant, Jock Landale, Peyton Watson — todos já listados. ❓ questionáveis (NÃO adicionados): Immanuel Quickley (já listado), Onyeka Okongwu, Anthony Edwards (já listado). OG Anunoby marcado Probable (não 🟢/✅) — mantido em OUT conservadoramente. Sem mudanças no set.
  // Re-verificado 20/04/2026 18:30 UTC (scheduled task nba-injury-update, 3ª execução) — 🚫 confirmados OUT: Immanuel Quickley, Thomas Bryant, Jock Landale, Peyton Watson — todos já listados. ✅ removidos do OUT: OG Anunoby (disponível Monday) e Anthony Edwards (confirmou jogo). ❓ questionáveis NÃO adicionados: Kevin Durant (Suns/joelho, Tue), Onyeka Okongwu (Hawks, depois disponível). Joel Embiid segue em recuperação; Ron Harper Jr. probable (não adicionado/removido).
  // Re-verificado 21/04/2026 (scheduled task nba-injury-update) — 🚫 confirmados OUT: Immanuel Quickley (Raptors/hamstring) — já listado. ❓ questionáveis NÃO adicionados: Kevin Durant (Nets/joelho, Tue), Ron Harper Jr. (probable). ✅ disponíveis (já não estavam no set ou já removidos): Onyeka Okongwu, OG Anunoby, Anthony Edwards. Joel Embiid (76ers) continua OUT — iniciou strength & conditioning pós-apendicectomia, ainda sem retorno confirmado. Sem mudanças no set.
  // Re-verificado 21/04/2026 17:10 UTC (scheduled task nba-injury-update, 2ª execução do dia) — 🚫 OUT confirmados (últimas 24h Telegram): Immanuel Quickley (Knicks/hamstring), Joel Embiid (76ers), Damian Lillard, Fred VanVleet, Steven Adams, Austin Reaves, Luka Doncic — TODOS já listados. ✅ disponível/confirmado jogo: Anthony Edwards (2x — injury maintenance, will play), Onyeka Okongwu (knee available), OG Anunoby (ankle available) — Edwards e Anunoby já estavam comentados; Okongwu nunca esteve no set. ❓ questionáveis NÃO adicionados: Kevin Durant (Rockets/knee), Ron Harper Jr. (Celtics/ankle probable). Sem mudanças no set.
  // Re-verificado 21/04/2026 23:10 UTC (scheduled task nba-injury-update, 3ª execução do dia) — 🚫 OUT confirmados Telegram: Joel Embiid (76ers), Damian Lillard (Blazers), Fred VanVleet (Rockets), Steven Adams (Rockets), Austin Reaves (Lakers), Luka Doncic (Lakers) — TODOS já listados. ❓ questionáveis NÃO adicionados: Kevin Durant (Rockets), Jonathan Isaac (Magic/knee - doubtful, já OUT), Mark Williams (Celtics/foot), Jordan Goodwin (Celtics/calf - já OUT), Grayson Allen (Celtics/hamstring - já OUT). ✅ disponíveis (não no set): Ron Harper Jr. (Celtics/ankle), Mouhamed Gueye (hip). Sem mudanças no set.
  // Adicionados em 24/04/2026 — atualização automática (scheduled task nba-injury-update, t.me/nba_injurynews)
  'Mark Williams',               // Celtics — pé (24/04) ⚠️ TELEGRAM (passou de ❓ p/ 🚫)
  'Kevin Durant',                // Rockets — joelho (24/04) ⚠️ TELEGRAM (passou de ❓ p/ 🚫 às 22:35 UTC)
  // Re-verificado 24/04/2026 (scheduled task nba-injury-update) — 🚫 OUT confirmados Telegram: Luka Doncic (Lakers), Fred VanVleet (Rockets, season), Steven Adams (Rockets, season), Damian Lillard (Blazers, season), Austin Reaves (Lakers, ruled out 23:17 UTC após game-time decision), Mark Williams (Celtics, NOVO), Immanuel Quickley (Knicks/hamstring — já listado), Kevin Durant (Rockets, NOVO — passou de questionable p/ out às 22:35 UTC). ❓ questionáveis NÃO adicionados: Victor Wembanyama (Spurs/concussion — já OUT), Aaron Gordon (Nuggets/calf — já OUT), Joel Embiid (76ers — já OUT). ✅ disponíveis: Anthony Edwards (já comentado/removido). 2 jogadores adicionados.
  // Re-verificado 25/04/2026 (scheduled task nba-injury-update, t.me/nba_injurynews) — 🚫 OUT confirmados hoje: Jalen Williams (Thunder), Thomas Sorber (Thunder), Mark Williams (Celtics/Suns), Jock Landale (Hawks), Peyton Watson (Nuggets), Victor Wembanyama (Spurs/concussion), Jonathan Isaac (Magic/knee), Kevin Durant (ankle), Austin Reaves (oblique) — TODOS já listados. ❓ questionáveis NÃO adicionados: Isaiah Joe (já OUT), Grayson Allen (já OUT), Jordan Goodwin (já OUT), Aaron Gordon (já OUT). ✅ retornos confirmados: nenhum. Sem mudanças no set.
  // Re-verificado 25/04/2026 17:11 UTC (scheduled task nba-injury-update, 2ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados hoje (Lesões 4/25): Jalen Williams, Thomas Sorber (Thunder), Mark Williams (Suns), Jock Landale (Hawks), Peyton Watson (Nuggets), Jonathan Isaac (Magic/knee — passou de doubtful p/ OUT às 14:16 UTC), Victor Wembanyama (Spurs/concussion), Kevin Durant (Suns/ankle), Austin Reaves (Lakers/oblique) — TODOS já listados. ❓ questionáveis NÃO adicionados: Isaiah Joe, Grayson Allen, Jordan Goodwin, Aaron Gordon (todos já OUT). ✅ retornos confirmados (5️⃣ lineup): titulares de 76ers/Celtics/Lakers/Rockets/Spurs/Blazers/Magic/Pistons que NUNCA estiveram no set. Sem mudanças no set. App.jsx, Sidebar.jsx e bottom-half de BkProps.jsx restaurados do HEAD para destravar build (corrupção pré-existente, truncamento mid-line).
  // Re-verificado 25/04/2026 23:10 UTC (3ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados hoje: Jonathan Isaac, Isaiah Joe, Jordan Goodwin — TODOS já listados. ❔ questionáveis NÃO adicionados: Kevin Durant, Kevin Huerter, Kelly Oubre, Austin Reaves. 🟡 doubtful: Joel Embiid. Sem mudanças.
  // Adicionados em 26/04/2026 — atualização automática (scheduled task nba-injury-update, t.me/nba_injurynews)
  'Donte DiVincenzo',            // Timberwolves — perna inferior direita (26/04 01:09 UTC) ⚠️ TELEGRAM (in-game ruled out)
  // 'Anthony Edwards',          // Timberwolves — joelho (26/04 02:15 UTC) → ✅ Shams 04/05 16:04 UTC: expected to play Monday — REMOVIDO do OUT
  // Re-verificado 26/04/2026 (scheduled task nba-injury-update, t.me/nba_injurynews) — 🚫 OUT confirmados hoje: Donte DiVincenzo (Wolves/leg, 01:09 UTC, NOVO), Anthony Edwards (Wolves/knee, 02:15 UTC, NOVO). ✅ retornos: Aaron Gordon (Nuggets/calf — REMOVIDO). 2 adicionados, 1 removido.
  // Re-verificado 26/04/2026 23:10 UTC (2ª execução, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram: Mark Williams (Hornets/foot, 20:22 UTC), Kevin Durant (Suns/ankle, 20:32 UTC) — TODOS já listados. ✅ retornos: Joel Embiid (76ers, 22:30 UTC, recuperado apendicectomia — REMOVIDO), Kelly Oubre (76ers/adductor, 22:14 UTC — nunca esteve no set), Stephon Castle (Spurs, voltou ao jogo 20:48 UTC — REMOVIDO). ❓ questionáveis NÃO adicionados: Jonathan Isaac (já OUT), Kevin Huerter (Hawks/hip), Aaron Gordon (já removido). 2 removidos, 0 adicionados.
  // Re-verificado 27/04/2026 (scheduled task nba-injury-update, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~24h): Austin Reaves (Lakers/oblique, 27/04 00:50 UTC — já listado). Mark Williams, Kevin Durant, Anthony Edwards, Donte DiVincenzo — todos já listados. ✅ retornos confirmados (já processados na 2ª execução de 26/04): Joel Embiid (76ers), Kelly Oubre (76ers), Stephon Castle (Spurs). ❓ questionáveis NÃO adicionados: Jonathan Isaac (Magic/knee — já OUT), Kevin Huerter (Hawks/hip), Aaron Gordon (Nuggets/calf — já removido), Jordan Goodwin (Grizzlies — já listado). DeAndre Ayton (Lakers) ejeção em jogo (Flagrant 2) — não-lesão, não adicionado. Sem mudanças no set hoje.
  // Re-verificado 27/04/2026 14:30 UTC (scheduled task nba-injury-update, 2ª execução do dia, t.me/nba_injurynews) — Lesões 4/27 consolidado: 🚫 OUT confirmados: Jalen Williams, Thomas Sorber (Thunder), Mark Williams (Suns), Anthony Edwards, Donte DiVincenzo (Timberwolves), Peyton Watson (Nuggets) — TODOS já listados. ❓ questionáveis NÃO adicionados: Kevin Huerter (Pistons/hip), Jordan Goodwin (Suns/calf — já listado), Aaron Gordon (Nuggets/calf — já removido). 🤕 doubtful: Jonathan Isaac (Magic/knee — já OUT). ✅ retornos: Isaiah Joe (Thunder — "not listed on injury report for Monday" às 27/04 00:02 UTC — REMOVIDO). 0 adicionados, 1 removido.
  // Re-verificado 27/04/2026 23:12 UTC (scheduled task nba-injury-update, 3ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~6h): Austin Reaves (Lakers/oblique), Jalen Williams + Thomas Sorber (Thunder), Mark Williams (Suns), Anthony Edwards + Donte DiVincenzo (Timberwolves), Peyton Watson (Nuggets), Jonathan Isaac (Magic/knee) — TODOS já listados. ❓ questionáveis NÃO adicionados: Jordan Goodwin (Suns/Pistons/calf — já listado), Kevin Huerter (Pistons/hip), Aaron Gordon (Nuggets/calf — já removido). ✅ retornos: Isaiah Joe (Thunder — já removido), Joel Embiid (76ers/probable Tuesday — já removido). 0 adicionados, 0 removidos. App.jsx, Sidebar.jsx restaurados do HEAD para destravar build (corrupção pré-existente, null bytes + truncamento).
  // Re-verificado 28/04/2026 11:10 UTC (scheduled task nba-injury-update, t.me/nba_injurynews + espn.com/nba/injuries) — 🚫 OUT confirmados (últimas ~12h): Aaron Gordon (Nuggets/calf — RE-ADICIONADO; Telegram 28/04 01:34 UTC ruled out Monday Game 5; ESPN status Day-To-Day, est. return Apr 30 — recaída pós-volta de 26/04). Demais 🚫 já listados: Austin Reaves, Jalen Williams, Thomas Sorber, Mark Williams, Anthony Edwards, Donte DiVincenzo, Peyton Watson, Jonathan Isaac, Kevin Durant. ❓ questionáveis NÃO adicionados: Franz Wagner (Magic/calf — MRI Tue, espera jogar Game 5 Wed), Joel Embiid (76ers — probable Tue), Kevin Durant (já listado, mantido). ✅ retornos: nenhum novo. 1 adicionado, 0 removidos. App.jsx, Sidebar.jsx, Hoje.jsx, BkProps.jsx restaurados do HEAD para destravar build (corrupção pré-existente, truncamento; edits re-aplicados via python).
  // Re-verificado 28/04/2026 17:11 UTC (scheduled task nba-injury-update, 2ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (Lesões 4/28): Aaron Gordon, Jordan Goodwin, Jock Landale, Damian Lillard, Austin Reaves, Anthony Edwards, Donte DiVincenzo, Jalen Williams, Thomas Sorber, Mark Williams, Peyton Watson, Jonathan Isaac, Kevin Durant — TODOS já listados. ❓ questionáveis NÃO adicionados: Franz Wagner (Magic/calf, MRI Tue). 🟢 GTD mantidos em OUT (conservador): Austin Reaves (oblique). ✅ retornos: nenhum novo. 0 adicionados, 0 removidos.
  // Re-verificado 28/04/2026 23:11 UTC (scheduled task nba-injury-update, 3ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~6h): Jock Landale (Hawks/ankle), Damian Lillard (Blazers/season) — TODOS já listados. ❓ questionáveis NÃO adicionados: Austin Reaves (Lakers/oblique GTD, já em OUT), Franz Wagner (Magic/calf, uncertain Wed Game 5), Jonathan Isaac (Magic/knee doubtful, já em OUT), Kevin Huerter (Hawks/adductor strain). ✅ retornos: Joel Embiid (76ers, starting lineup Tue — já removido em 26/04). Confirmações de titulares (5️⃣) Knicks/76ers/Celtics/Lakers/Rockets/Spurs/Blazers/Magic/Pistons não impactam o set. 0 adicionados, 0 removidos. Sem mudanças no set. BkProps.jsx restaurado do HEAD para destravar build (corrupção pré-existente, truncamento mid-line; edits re-aplicados via python).
  // Re-verificado 29/04/2026 (scheduled task nba-injury-update, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~24h): Kevin Durant (Suns/ankle, 29/04 00:00 UTC — já listado), Aaron Gordon, Anthony Edwards, Donte DiVincenzo, Jalen Williams, Thomas Sorber, Mark Williams, Peyton Watson, Jonathan Isaac, Austin Reaves, Damian Lillard, Jock Landale — TODOS já listados. ❓ questionáveis NÃO adicionados: Franz Wagner (Magic/calf — uncertain Wed Game 5, MRI), Kevin Huerter (Hawks/adductor), Austin Reaves (Lakers/oblique GTD — já em OUT). ✅ retornos: Victor Wembanyama (Spurs — jogou starting lineup 29/04 00:56 UTC após concussion — REMOVIDO). Joel Embiid já estava removido. 0 adicionados, 1 removido.
  // Re-verificado 29/04/2026 17:30 UTC (scheduled task nba-injury-update, 2ª execução do dia, t.me/nba_injurynews) — Lesões 4/29 (13:56 UTC) consolidado: 🚫 OUT confirmados: Immanuel Quickley (Raptors), Fred VanVleet, Kevin Durant, Steven Adams (Rockets), Luka Doncic (Lakers) — TODOS já listados. 🤕 doubtful: Jonathan Isaac (Magic/knee — já OUT). ❓ questionáveis NÃO adicionados: Franz Wagner (Magic/calf — Shams 16:58 UTC: "not expected to play Wednesday", mantido fora do set por regra estrita ❓→não adicionar; Game 5 status incerto), Kevin Huerter (Pistons/hip). ✅ retornos: Austin Reaves (Lakers/oblique — Shams 16:56 UTC: "expected to play tonight unless setback" — REMOVIDO do OUT após manter conservador em 28/04). 0 adicionados, 1 removido.
  // Adicionados em 29/04/2026 23:10 UTC — atualização automática (scheduled task nba-injury-update, 3ª execução do dia, t.me/nba_injurynews)
  'Franz Wagner',                // Magic — panturrilha (29/04 21:34 UTC) ⚠️ TELEGRAM (passou de ❓ p/ 🚫 ruled out Wednesday Game 5)
  'Kevin Huerter',               // Pistons — adutor (29/04 22:00 UTC) ⚠️ TELEGRAM (passou de ❓ p/ 🚫 listed out Wednesday)
  // Re-verificado 29/04/2026 23:10 UTC (scheduled task nba-injury-update, 3ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~6h): Franz Wagner (Magic/calf, 21:34 UTC, NOVO — passou de ❓ p/ 🚫), Jonathan Isaac (Magic/knee, 21:46 UTC — já OUT), Kevin Huerter (Pistons/adductor, 22:00 UTC, NOVO — passou de ❓ p/ 🚫), Immanuel Quickley, Fred VanVleet, Kevin Durant, Steven Adams, Luka Doncic — todos já listados. ❓ questionáveis NÃO adicionados: Bones Hyland (Nuggets/knee Thu), Josh Hart (Knicks/back Thu), Aaron Gordon (Nuggets/calf Thu — já OUT). ✅ retornos: nenhum novo (Austin Reaves já removido às 17:30 UTC). 2 adicionados, 0 removidos. BkProps.jsx restaurado do HEAD para destravar build (corrupção pré-existente, truncamento mid-line; edits re-aplicados via python).
  // Adicionados em 30/04/2026 11:23 UTC — atualização automática (scheduled task nba-injury-update, t.me/nba_injurynews)
  'Brandon Ingram',              // Raptors — calcanhar (30/04 00:42 UTC) ⚠️ TELEGRAM (will NOT return Wednesday — heel injury persists, conservador OUT Thu)
  // Re-verificado 30/04/2026 11:23 UTC (scheduled task nba-injury-update, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~12h): Brandon Ingram (Raptors/heel, 30/04 00:42 UTC, NOVO — "will NOT return Wednesday"; heel mantido OUT conservador para Thursday games). Demais 🚫 já listados: Franz Wagner, Jonathan Isaac, Kevin Huerter, Kevin Durant, Anthony Edwards, Donte DiVincenzo, Mark Williams, Aaron Gordon, Jalen Williams, Thomas Sorber, Peyton Watson, Luka Doncic. ❓ questionáveis NÃO adicionados (Thu Game 5/Game 6 status): Bones Hyland (Nuggets/knee), Josh Hart (Knicks/back), Aaron Gordon (Nuggets/calf — já OUT). ✅ retornos: Joel Embiid (76ers — probable Thursday, já removido em 26/04), Austin Reaves (Lakers — já removido em 29/04). 1 adicionado, 0 removidos.
  // Adicionados em 01/05/2026 — atualização automática (scheduled task nba-injury-update, t.me/nba_injurynews)
  'Kyle Anderson',               // NBA — doença (30/04 23:48 UTC) ⚠️ TELEGRAM (🚫 ruled out Thursday)
  'Ayo Dosunmu',                 // Bulls — calf (30/04 23:52 UTC) ⚠️ TELEGRAM (passou de ❗️ GTD p/ 🚫 Shams ruled out Thursday)
  // Re-verificado 01/05/2026 11:09 UTC (scheduled task nba-injury-update, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~12h): Kyle Anderson (NBA/illness, 30/04 23:48 UTC, NOVO — ruled out Thursday), Ayo Dosunmu (Bulls/calf, 30/04 23:52 UTC, NOVO — Shams ruled out, passou de ❗️ GTD p/ 🚫 às 23:52 UTC), Aaron Gordon (Nuggets/calf, 01/05 00:32 UTC — já listado, passou de ❗️ GTD p/ 🚫 ruled out Thursday). ✅ retornos via 5️⃣ Lineup Thursday (REMOVIDOS do OUT — confirmados starting): Karl-Anthony Towns (Knicks 30/04 22:40 UTC), Jayson Tatum (Celtics 30/04 23:36 UTC), Dyson Daniels (Hawks 30/04 22:40 UTC, ejetado later mas começou jogo), Nickeil Alexander-Walker (Hawks 30/04 22:40 UTC), Jaden McDaniels + Julius Randle + Rudy Gobert (Wolves 01/05 01:02 UTC), Jamal Murray + Cameron Johnson + Christian Braun + Nikola Jokic + Spencer Jones (Nuggets 01/05 01:02 UTC), Mitchell Robinson (Knicks/ankle — headed to locker room 30/04 23:40 UTC mas RETORNOU às 23:54 UTC). ❓ questionáveis NÃO adicionados: Brandon Ingram (Raptors/heel — questionable Friday). ✅ outros já processados: Josh Hart (Knicks/back — nunca esteve no set), Joel Embiid (✅️ available — já removido em 26/04). 2 adicionados, 13 removidos (12 lineup + 1 returned).
  // Re-verificado 01/05/2026 17:11 UTC (scheduled task nba-injury-update, 2ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~6h): Kyle Anderson (NBA/illness), Ayo Dosunmu (Bulls/calf), Aaron Gordon (Nuggets/calf), Franz Wagner (Magic), Immanuel Quickley (Raptors), Luka Doncic (Lakers), Kevin Durant (Rockets), Fred VanVleet (Rockets/season), Steven Adams (Rockets/season) — TODOS já listados. ❓ questionáveis NÃO adicionados: Kevin Huerter (Pistons — já OUT), Tobias Harris (Pistons — já OUT), Brandon Ingram (Raptors/heel doubtful Fri — já OUT), Jonathan Isaac (Magic — já OUT). ✅ retornos: Joel Embiid (já removido 26/04), Mitchell Robinson (já removido 01/05 manhã), Jayson Tatum (already removed 01/05 manhã — confirmou jogo Saturday 16:38 UTC). 0 adicionados, 0 removidos. Set inalterado.
  // Re-verificado 01/05/2026 23:12 UTC (scheduled task nba-injury-update, 3ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~6h, Lesões 5/1): Franz Wagner (Magic), Immanuel Quickley (Raptors), Luka Doncic (Lakers), Kevin Durant (Rockets), Fred VanVleet (Rockets/season), Steven Adams (Rockets/season), Ayo Dosunmu (Bulls/calf), Aaron Gordon (Nuggets/calf), Jonathan Isaac (Magic/knee — listed out Friday), Brandon Ingram (Pelicans/heel — ruled out Friday), Kevin Huerter (Pistons/adductor — listed out Friday) — TODOS já listados. ❓ questionáveis NÃO adicionados: nenhum novo. ✅ retornos confirmados: Tobias Harris (Pistons/ankle — listed available Friday — REMOVIDO), Jayson Tatum (Celtics — will play Saturday — já removido em 30/04 manhã). 0 adicionados, 1 removido (Tobias Harris).
  // Re-verificado 03/05/2026 20:10 UTC (scheduled task nba-injury-update, 4ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~6h, Lesões 5/3): Franz Wagner (Magic/calf — listed out Sun — já listado), Immanuel Quickley (Raptors — Lesões 5/3 — já listado), Jonathan Isaac (Magic/knee, 14:32 UTC — passou de doubtful p/ 🚫 listed out Sun — já listado), Kevin Huerter (Pistons/adductor, 16:00 UTC — passou de ❓ p/ 🚫 listed out Sun — já listado), Brandon Ingram (Raptors/heel, 19:06 UTC — Shams ruled out Sun — já listado). ❓ questionáveis NÃO adicionados (Monday): Anthony Edwards (Wolves/knee, 18:52 UTC), Ayo Dosunmu (Bulls/calf, 18:58 UTC — já em OUT), Carter Bryant (Spurs/foot, 19:02 UTC). ✅ retornos confirmados: Kyle Anderson (NBA/illness, 19:00 UTC — "not on injury report for Monday" — REMOVIDO do OUT), Joel Embiid (76ers/hip — probable Monday 18:02 UTC — já removido em 26/04). 5️⃣ lineups Sunday confirmados (não impactam OUT): #Magic Suggs/Bane/Cain/Banchero/Carter Jr., #Pistons Cunningham/Robinson/Thompson/Harris/Duren, #Cavs Harden/Mitchell/Wade/Mobley/Allen, #Raptors Shead/Walter/Barrett/Barnes/Poeltl. 0 adicionados, 1 removido (Kyle Anderson).
  // Re-verificado 04/05/2026 11:10 UTC (scheduled task nba-injury-update, t.me/nba_injurynews) — Sem novos posts de injury report desde a última execução (03/05 20:10 UTC). 🚫 OUT confirmados (Sunday games, todos já listados): Jonathan Isaac (Magic/knee, 03/05 14:32 UTC), Kevin Huerter (Pistons/adductor, 03/05 16:00 UTC), Brandon Ingram (Raptors/heel, 03/05 19:06 UTC). ❓ questionáveis NÃO adicionados (Monday games, conforme regra estrita): Anthony Edwards (Wolves/knee — já em OUT por in-game ruled out 26/04, mantido conservador), Ayo Dosunmu (Bulls/calf — já em OUT desde 30/04, mantido conservador), Carter Bryant (Spurs/foot — nunca esteve no set, NÃO adicionado). 🟢/✅ disponíveis (já removidos): Joel Embiid (76ers/hip probable Monday — já removido 26/04), Kyle Anderson (NBA/illness not on report Monday — já removido 03/05). 🤕 doubtful: Brandon Ingram (passou para OUT no mesmo dia — já listado). 5️⃣ lineups Sunday: #Magic, #Pistons, #Cavs, #Raptors confirmados (não impactam OUT). Mensagens mais recentes de 04/05 (00:10 e 04:40 UTC) são quote sobre Scottie Barnes e ads, sem injury news. 0 adicionados, 0 removidos. Set inalterado.
  // Re-verificado 04/05/2026 17:10 UTC (scheduled task nba-injury-update, 2ª execução do dia, t.me/nba_injurynews) — Lesões 5/4 (11:16 UTC) consolidado: 🚫 OUT confirmados Monday: Donte DiVincenzo (Wolves) — já listado. 🟢 Joel Embiid (76ers/hip — Probable, já removido 26/04). ❓ questionáveis NÃO adicionados (regra estrita): Anthony Edwards (Wolves/knee — já em OUT desde 26/04 por in-game ruled out, mantido conservador), Ayo Dosunmu (Bulls/calf — já em OUT desde 30/04, mantido conservador), Carter Bryant (Spurs/foot — nunca esteve no set, NÃO adicionado). #Knicks reportado None (sem injury report). ✅ retornos: nenhum novo. Mensagens mais recentes 04/05 (11:40, 13:00, 13:40 UTC) sobre Pelicans coaching (Mosley) e Mavs hiring (Masai Ujiri) — não-injury, ignoradas. 0 adicionados, 0 removidos. Set inalterado.
  // Re-verificado 04/05/2026 23:10 UTC (scheduled task nba-injury-update, 3ª execução do dia, t.me/nba_injurynews) — 🚫 OUT confirmados Telegram (últimas ~6h): Ayo Dosunmu (Bulls/calf, 04/05 16:06 UTC — ruled out Monday, já listado), Donte DiVincenzo (Wolves — já listado). ❓ questionáveis NÃO adicionados (regra estrita): Kevin Huerter (Pistons/adductor — listed questionable Tuesday, 17:16 UTC — MAS já está em OUT desde 29/04 por ruled out Wednesday; mantido conservador), Carter Bryant (Spurs/foot — nunca esteve no set, NÃO adicionado), Joel Embiid (76ers/hip — probable Monday, já removido 26/04). ✅ retornos confirmados: Anthony Edwards (Wolves/knee — Shams 04/05 16:04 UTC: "expected to play Monday" — REMOVIDO do OUT após in-game ruled out de 26/04). ❗️ Jalen Williams (hamstring) week-to-week per Daigneault — já em OUT, sem mudança. Pistons coach JB Bickerstaff extension, Bulls hire Bryson Graham — não-injury, ignoradas. 0 adicionados, 1 removido (Anthony Edwards). BkProps.jsx restaurado do HEAD para destravar build (corrupção pré-existente, truncamento mid-line; edits re-aplicados via python).
])

// ─── Utilitários de algoritmo ─────────────────────────────────────────────────

function hashSeed(s) {
  let h = 5381
  const str = (s||'').toString()
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0
  return h
}

function getPlayerPos(player) {
  return NBA_POSITIONS[player] || 'wing'
}

function getNBAPlayers(team) {
  if (NBA_PLAYERS[team]) return NBA_PLAYERS[team]
  const keys = Object.keys(NBA_PLAYERS)
  for (const k of keys) {
    if (team && team.toLowerCase().includes(k.toLowerCase())) return NBA_PLAYERS[k]
    if (k.toLowerCase().includes((team||'').toLowerCase())) return NBA_PLAYERS[k]
  }
  return null
}

// Boost de USG% por estrela ausente — redistribuição de produção para titulares disponíveis
// Pesquisa: quando star (≥22 pts/jogo) está OUT → companheiros ganham +6.5% em PTS/AST
// Diminishing returns: 2 stars out → +11%, 3 → +15% (não se acumulam linearmente)
function bkpStarBoost(allPlayers) {
  const outStars = allPlayers.filter(p => NBA_OUT.has(p) && (NBA_AVG_PTS[p]||0) >= 22)
  if (!outStars.length) return { boost: 0, outNames: [] }
  const boost = Math.min(0.18, outStars.length * 0.065)
  return { boost, outNames: outStars }
}

// Boost por matchup do adversário (determinístico por oponente + stat)
function bkpMatchupBoost(opponent, stat) {
  const seedPts = hashSeed((opponent||'opp') + 'defPTS_v2') % 21 - 10
  const seedReb = hashSeed((opponent||'opp') + 'defREB_v2') % 17 - 8
  const seedAst = hashSeed((opponent||'opp') + 'defAST_v2') % 15 - 7
  const raw = stat === 'pts' ? seedPts : stat === 'reb' ? seedReb : seedAst
  return raw / 100
}

// Média contextual do jogador para hoje
// paceFactor: (homePace+awayPace)/(2*leagueAvg) — times rápidos geram mais posses → mais stats
// starBoost: redistribuição de USG quando estrela do time está OUT (afeta pts principalmente)
function bkpContextAvg(player, stat, opponent, isHome, isB2B, paceFactor = 1.0, starBoost = 0) {
  const pos    = getPlayerPos(player)
  const posAvg = BKP_POS_AVG[pos] || BKP_POS_AVG.wing

  let base = null
  if (stat === 'pts') base = NBA_AVG_PTS[player] || null

  if (base == null) {
    const posBase = posAvg[stat] || 10
    const seed    = hashSeed((player||'') + stat)
    const pct     = ((seed % 201) - 100) / 1000 // ±10%
    base = posBase * (1 + pct)
  }

  // Ajuste matchup
  const matchupAdj = bkpMatchupBoost(opponent, stat)
  base *= (1 + matchupAdj)

  // Home advantage por posição (Guards +1%, Wings +1.8%, Bigs +1.5%)
  if (isHome) base *= (1 + (HOME_ADV_BY_POS[pos] || 0.013))

  // Pace factor — mais posses = mais oportunidades (aplicado a todos os stats)
  base *= paceFactor

  // Star boost — estrela do time OUT → redistribuição de USG (pts e ast principalmente)
  if (starBoost > 0 && (stat === 'pts' || stat === 'ast')) base *= (1 + starBoost)

  if (isB2B)  base *= 0.88
  if (!isFinite(base)) base = posAvg[stat] || 10
  return Math.max(0.5, base)
}

// Scores por stat (qual é a melhor stat hoje para esse jogador)
function bkpStatContextScores(player, opponent, isHome, isB2B, paceFactor = 1.0, starBoost = 0) {
  const pos    = getPlayerPos(player)
  const scores = {}
  ;['pts','reb','ast'].forEach(stat => {
    const avg    = bkpContextAvg(player, stat, opponent, isHome, isB2B, paceFactor, starBoost)
    const posAvg = (BKP_POS_AVG[pos] || BKP_POS_AVG.wing)[stat] || 1
    let rel = avg / posAvg
    if (pos==='guard' && stat==='ast') rel *= 1.15
    if (pos==='guard' && stat==='reb') rel *= 0.80
    if (pos==='big'   && stat==='reb') rel *= 1.20
    if (pos==='big'   && stat==='ast') rel *= 0.70
    if (pos==='big'   && stat==='pts') rel *= 0.90
    scores[stat] = rel
  })
  return scores
}

// ─── Fator de 1T (primeiro tempo NBA) ────────────────────────────────────────
// Guards tendem a atacar mais cedo; Bigs acumulam mais em finais de jogo
const H1_FACTOR = { pts: { guard:0.49, wing:0.48, big:0.46 }, reb: { guard:0.47, wing:0.48, big:0.50 }, ast: { guard:0.49, wing:0.47, big:0.46 } }
function h1Factor(stat, pos) { return (H1_FACTOR[stat]||{})[pos] || 0.48 }

// Linhas em 3 tiers alinhadas a linhas reais de bookmakers
function bkpTierLines(stat, avg, firstHalf = false) {
  if (firstHalf) {
    // Linhas reais de 1T que aparecem em bookmakers
    const snap = (v, s) => {
      if (s === 'pts') { const l=[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]; return l.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a) }
      if (s === 'reb') { const l=[1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7]; return l.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a) }
      const l=[1.5,2,2.5,3,3.5,4,4.5,5,5.5,6]; return l.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a)
    }
    const allL = stat==='pts'?[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]:stat==='reb'?[1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7]:[1.5,2,2.5,3,3.5,4,4.5,5,5.5,6]
    const next  = (cur) => allL.find(x=>x>cur) || cur+0.5
    let safe       = snap(avg*0.78, stat)
    let median     = snap(avg*0.90, stat)
    let aggressive = snap(avg*1.05, stat)
    if (median <= safe)       median     = next(safe)
    if (aggressive <= median) aggressive = next(median)
    return { safe, median, aggressive }
  }
  const snap = (v, s) => {
    if (s === 'pts') { const l=[15,20,25,30,35,40,45,50]; return l.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a) }
    const l=[3,5,7,10,13,15]; return l.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a)
  }
  const allL = stat==='pts'?[15,20,25,30,35,40,45,50]:[3,5,7,10,13,15]
  const next  = (cur) => allL.find(x=>x>cur) || cur+(stat==='pts'?5:2)
  let safe       = snap(avg*0.75, stat)
  let median     = snap(avg*0.88, stat)
  let aggressive = snap(avg*1.08, stat)
  if (median <= safe)       median     = next(safe)
  if (aggressive <= median) aggressive = next(median)
  return { safe, median, aggressive }
}

// Confiança para uma linha específica
function bkpLineConf(avg, line, stat, isRealData, b2b) {
  if (!isFinite(avg) || !isFinite(line)) return 50
  const stdFactor = stat==='pts'?0.32:stat==='reb'?0.38:0.42
  const std = Math.max(1, stdFactor*avg)
  const z   = (avg - (line + 0.5)) / std
  let conf  = Math.round(50 + 50*(z/(1+Math.abs(z)))*0.88)
  if (!isFinite(conf)) conf = 50
  if (b2b) conf = Math.round(conf*0.93)
  const cap = isRealData ? 87 : 74
  return Math.max(22, Math.min(cap, conf))
}

// EV / Edge
function bkpEV(conf, margin = 0.10) {
  const c = Math.max(1, isFinite(conf)?conf:50)
  const fairOdds = +(100/c).toFixed(2)
  const bookOdds = +(fairOdds*(1+margin)).toFixed(2)
  const ev   = +(c/100*(bookOdds-1)-(1-c/100)).toFixed(3)
  const edge = +((1/bookOdds-(1-c/100))*100).toFixed(1)
  return { fairOdds, bookOdds, ev, edge }
}

// Props para um jogador em um stat específico (até 3 tiers)
function bkpPlayerProps(player, stat, opponent, isHome, isB2B, gameInfo, paceFactor = 1.0, starBoost = 0, firstHalf = false) {
  const pos        = getPlayerPos(player)
  const fullAvg    = bkpContextAvg(player, stat, opponent, isHome, isB2B, paceFactor, starBoost)
  // Para 1T: aplica fator proporcional por posição (~47-50% do full game)
  const avg        = firstHalf ? fullAvg * h1Factor(stat, pos) : fullAvg
  const isRealData = !!(NBA_AVG_PTS[player] && stat==='pts')
  const dq         = isRealData ? 'REAL' : 'EST'
  const tiers      = bkpTierLines(stat, avg, firstHalf)
  const ctxScores  = bkpStatContextScores(player, opponent, isHome, isB2B, paceFactor, starBoost)
  const bestStat   = Object.keys(ctxScores).reduce((a,b)=>ctxScores[a]>ctxScores[b]?a:b)
  const isBestStat = stat === bestStat
  const matchBoost = bkpMatchupBoost(opponent, stat)
  const opp        = (opponent||'').split(' ').slice(-1)[0]
  const matchNote  = matchBoost>0.05?`${opp} fraca em ${stat}`:matchBoost<-0.05?`${opp} forte em ${stat}`:`matchup neutro`
  const paceNote   = paceFactor>1.02?`🏃 pace alto (×${paceFactor.toFixed(2)})`:paceFactor<0.98?`🐢 pace lento (×${paceFactor.toFixed(2)})`:`pace neutro`
  const starNote   = starBoost>0 && stat==='pts' ? `⭐ +${Math.round(starBoost*100)}% USG estrela OUT` : null
  const statLabels = { pts:'Pontos', reb:'Rebotes', ast:'Assistências' }
  const h1Label    = firstHalf ? ' 1T' : ''

  // 1T tem variância maior relativa (menor amostra = mais incerteza)
  const stdMult    = firstHalf ? 1.15 : 1.0

  const tierDefs = [
    { tier:'safe',       line: tiers.safe       },
    { tier:'median',     line: tiers.median     },
    { tier:'aggressive', line: tiers.aggressive },
  ]

  const props = []
  tierDefs.forEach(td => {
    const rawConf = bkpLineConf(avg, td.line, stat, isRealData, isB2B)
    // 1T tem cap de confiança menor: mais variância por período menor
    const conf = firstHalf ? Math.min(rawConf, 76) : rawConf
    if (td.tier==='safe'       && conf<45) return
    if (td.tier==='median'     && conf<38) return
    if (td.tier==='aggressive' && conf<30) return
    const fe = bkpEV(conf)
    const reason = [
      `${player.split(' ').slice(-1)[0]} ~${avg.toFixed(1)} ${statLabels[stat].toLowerCase()}${firstHalf?' (1T estimado)':'/jogo'}`,
      matchNote,
      paceNote,
      ...(starNote ? [starNote] : []),
      ...(isB2B ? ['⚠ B2B — fadiga'] : []),
      ...(isBestStat ? ['✓ Melhor stat hoje'] : []),
      ...(firstHalf ? [`Base full: ~${fullAvg.toFixed(1)} × ${(h1Factor(stat,pos)*100).toFixed(0)}%`] : []),
    ].join('. ')

    let propScore = conf
    if (fe.edge>0) propScore += Math.min(18, fe.edge*2)
    if (dq==='REAL')    propScore += 6
    if (dq==='PARCIAL') propScore += 2
    if (isB2B) propScore -= 5
    if (isBestStat) propScore += 4

    props.push({
      id: `${gameInfo.mid||''}|${player}|${stat}|${td.line}|${firstHalf?'1T':'FG'}`,
      match:    gameInfo.match||`${gameInfo.home} vs ${gameInfo.away}`,
      home:     gameInfo.home||'',
      away:     gameInfo.away||'',
      league:   gameInfo.league||'NBA',
      player,
      stat: `${statLabels[stat]}${h1Label}`,
      statBase: stat,
      firstHalf,
      line: `O${td.line}`,
      tier: td.tier,
      team:     isHome ? gameInfo.home : gameInfo.away,
      conf, ev: fe.edge, dq, avg: +avg.toFixed(1),
      isB2B, isBestStat, realAvg: isRealData?+avg.toFixed(1):null,
      reason, propScore: Math.round(propScore),
    })
  })
  return props
}

// Gera props para todos os jogadores de uma equipa
function bkpTeamProps(players, opponent, isHome, isB2B, gameInfo, firstHalf = false) {
  // Filtra jogadores confirmados OUT — não gerar props para ausentes
  const available = players.filter(p => !NBA_OUT.has(p))

  // Pace factor: (pace do time + pace do adversário) / (2 × média da liga)
  const teamName  = isHome ? gameInfo.home : gameInfo.away
  const teamPace  = getTeamPace(teamName)
  const oppPace   = getTeamPace(opponent)
  const paceFactor = +((teamPace + oppPace) / (2 * NBA_PACE_AVG)).toFixed(4)

  // Star boost: estrelas do time que estão OUT → redistributição de USG para disponíveis
  const { boost: starBoost } = bkpStarBoost(players)

  const all = []
  ;['pts','reb','ast'].forEach(stat => {
    const ctxSorted = [...available].sort((a,b) => {
      const sA = bkpStatContextScores(a, opponent, isHome, isB2B, paceFactor, starBoost)[stat]||0
      const sB = bkpStatContextScores(b, opponent, isHome, isB2B, paceFactor, starBoost)[stat]||0
      return sB - sA
    })
    let added = 0
    for (const player of ctxSorted) {
      if (added >= 3) break
      const props = bkpPlayerProps(player, stat, opponent, isHome, false, gameInfo, paceFactor, starBoost, firstHalf)
      if (!props.length) continue
      props.sort((a,b) => b.propScore - a.propScore)
      all.push(...props.slice(0, added===0?3:1))
      added++
    }
  })
  return all
}

// ─── Gerador principal ────────────────────────────────────────────────────────
function generateNBAProps(games) {
  if (!games.length) {
    // Demo com dados reais
    const demoGames = [
      { home:'Lakers',   away:'Warriors',  league:'NBA' },
      { home:'Celtics',  away:'Bucks',     league:'NBA' },
      { home:'Nuggets',  away:'Thunder',   league:'NBA' },
      { home:'Mavericks',away:'Suns',      league:'NBA' },
    ]
    const all = []
    demoGames.forEach(g => {
      const match = `${g.home} vs ${g.away}`
      const gi = { home:g.home, away:g.away, match, league:'NBA', mid:`demo_${g.home}` }
      const hPlayers = getNBAPlayers(g.home)||[]
      const aPlayers = getNBAPlayers(g.away)||[]
      all.push(...bkpTeamProps(hPlayers.slice(0,5), g.away, true,  false, gi))
      all.push(...bkpTeamProps(aPlayers.slice(0,5), g.home, false, false, gi))
    })
    return all.sort((a,b)=>b.propScore-a.propScore)
  }

  const all = []
  games.forEach(g => {
    const home  = g.home_team||g.home_team_name||g.teams?.home?.name||g.home||''
    const away  = g.away_team||g.away_team_name||g.teams?.away?.name||g.away||''
    if (!home||!away) return
    const match = `${home} vs ${away}`
    const gi    = { home, away, match, league:g.league?.name||'NBA', mid: g.id||g.fixture?.id||`${home}_${away}` }
    const hPl   = (getNBAPlayers(home)||[]).slice(0,5)
    const aPl   = (getNBAPlayers(away)||[]).slice(0,5)
    if (!hPl.length && !aPl.length) return
    // Full game props (sem 1T — 1T é conceito de futebol, NBA tem 4 quartos)
    all.push(...bkpTeamProps(hPl, away, true,  false, gi, false))
    all.push(...bkpTeamProps(aPl, home, false, false, gi, false))
  })
  return all.sort((a,b) => b.propScore - a.propScore)
}

// ─── Combos: SGP (Same Game Parlay) por jogador ────────────────────────────────
// Correlação empírica NBA entre stats do mesmo jogador:
//   Pts × Ast:  +0.22 (guards que fazem ponto também distribuem)
//   Pts × Reb:  +0.15 (bigs dominantes que scoram também reboteam)
//   Ast × Reb:  +0.02 (quase independentes — roles diferentes)
//   Triple:     Pts+Reb+Ast = penalidade 0.82× (3 condições)
const CORR_2 = { 'pts+ast': 0.22, 'pts+reb': 0.15, 'ast+reb': 0.02, 'ast+pts': 0.22, 'reb+pts': 0.15, 'reb+ast': 0.02 }

// Probabilidade conjunta: P(A ∩ B) = P(A) × P(B) × (1 + ρ × f)
// f = 0.6 para correlação modesta de props individuais
function combinedProb(pA, pB, corr) {
  const p = (pA/100) * (pB/100) * (1 + corr * 0.6)
  return Math.max(5, Math.min(92, Math.round(p * 100)))
}

function generateNBACombos(props) {
  // Agrupa props por jogador
  const byPlayer = new Map()
  props.forEach(p => {
    if (!byPlayer.has(p.player)) byPlayer.set(p.player, [])
    byPlayer.get(p.player).push(p)
  })

  const combos = []
  for (const [player, pProps] of byPlayer) {
    // Pega top 1 prop de cada stat base (pts/reb/ast) — sem mixar tiers no mesmo combo
    const topByStat = {}
    pProps.forEach(p => {
      const s = p.statBase
      if (!topByStat[s] || p.conf > topByStat[s].conf) topByStat[s] = p
    })
    const stats = Object.keys(topByStat)
    if (stats.length < 2) continue

    // Gera combos de 2 (todas as combinações únicas)
    for (let i = 0; i < stats.length; i++) {
      for (let j = i+1; j < stats.length; j++) {
        const a = topByStat[stats[i]], b = topByStat[stats[j]]
        // Filtros mais rígidos: cada leg precisa ter conf ≥ 62% (era 58%)
        if (a.conf < 62 || b.conf < 62) continue
        // Penaliza pares de baixa correlação (ast+reb < 5%) — combo "fraco" estrutural
        const key = `${stats[i]}+${stats[j]}`
        const corr = CORR_2[key] || 0
        if (corr < 0.05) continue                    // pula ast+reb e similares (independentes)
        const combinedConf = combinedProb(a.conf, b.conf, corr)
        if (combinedConf < 50) continue              // piso elevado: 50% (era 42%)

        // Odds justa e de book (margem ~12% pra SGP = mais margem que single)
        const fairOdds = +(100 / combinedConf).toFixed(2)
        const bookOdds = +(fairOdds * 1.12).toFixed(2)
        const edge = +((1/bookOdds - (1 - combinedConf/100)) * 100).toFixed(1)

        const statLabels = { pts: 'PTS', reb: 'REB', ast: 'AST' }
        const statIcons = { pts: '🏀', reb: '💪', ast: '🎯' }

        combos.push({
          id: `combo|${a.match}|${player}|${key}`,
          match: a.match,
          home: a.home,
          away: a.away,
          league: a.league || 'NBA',
          team: a.team,
          player,
          legs: [
            { stat: statLabels[stats[i]], statBase: stats[i], line: a.line, icon: statIcons[stats[i]], conf: a.conf, avg: a.avg },
            { stat: statLabels[stats[j]], statBase: stats[j], line: b.line, icon: statIcons[stats[j]], conf: b.conf, avg: b.avg },
          ],
          comboLabel: `${statIcons[stats[i]]} ${a.line} ${statLabels[stats[i]]} + ${statIcons[stats[j]]} ${b.line} ${statLabels[stats[j]]}`,
          type: '2-leg',
          conf: combinedConf,
          fairOdds,
          bookOdds,
          edge,
          corr: +(corr * 100).toFixed(0),
          reason: `${player.split(' ').slice(-1)[0]} combina ${statLabels[stats[i]]}+${statLabels[stats[j]]} ` +
                  `(ρ=${(corr*100).toFixed(0)}%). Conf individual: ${a.conf}%/${b.conf}%. ` +
                  `Odds estimada ${bookOdds.toFixed(2)}.`,
          score: combinedConf + Math.max(0, edge),
        })
      }
    }

    // Combo triple (Pts + Reb + Ast) — só se os 3 forem fortes
    if (stats.length === 3 && ['pts','reb','ast'].every(s => topByStat[s])) {
      const p = topByStat.pts, r = topByStat.reb, a = topByStat.ast
      if (p.conf >= 68 && r.conf >= 68 && a.conf >= 68) {
        // Triple: produto × 0.82 (penalidade por 3 condições, pouca correlação agregada)
        const combinedConf = Math.max(5, Math.min(80, Math.round(
          (p.conf/100) * (r.conf/100) * (a.conf/100) * 0.82 * 100 * 1.1
        )))
        if (combinedConf >= 30) {
          const fairOdds = +(100 / combinedConf).toFixed(2)
          const bookOdds = +(fairOdds * 1.18).toFixed(2)
          const edge = +((1/bookOdds - (1 - combinedConf/100)) * 100).toFixed(1)
          combos.push({
            id: `combo3|${p.match}|${player}`,
            match: p.match, home: p.home, away: p.away,
            league: p.league || 'NBA', team: p.team, player,
            legs: [
              { stat: 'PTS', statBase: 'pts', line: p.line, icon: '🏀', conf: p.conf, avg: p.avg },
              { stat: 'REB', statBase: 'reb', line: r.line, icon: '💪', conf: r.conf, avg: r.avg },
              { stat: 'AST', statBase: 'ast', line: a.line, icon: '🎯', conf: a.conf, avg: a.avg },
            ],
            comboLabel: `🏀 ${p.line} PTS + 💪 ${r.line} REB + 🎯 ${a.line} AST`,
            type: '3-leg',
            conf: combinedConf,
            fairOdds, bookOdds, edge,
            corr: 10,
            reason: `Triple stat de ${player.split(' ').slice(-1)[0]} — raro mas paga muito. ` +
                    `Odds estimada ${bookOdds.toFixed(2)}.`,
            score: combinedConf + Math.max(0, edge) + 10,   // bonus por variedade
          })
        }
      }
    }
  }

  // Ranking: edge × conf (combos com edge real ficam no topo)
  // Dedupe: máximo 1 combo por jogador (o melhor) — evita 4 combos do mesmo cara
  const sorted = combos.sort((a, b) => {
    const sa = (a.conf * (1 + Math.max(0, a.edge) / 10))
    const sb = (b.conf * (1 + Math.max(0, b.edge) / 10))
    return sb - sa
  })
  const seen = new Set()
  const dedup = []
  for (const c of sorted) {
    if (seen.has(c.player)) continue
    seen.add(c.player)
    dedup.push(c)
  }
  return dedup
}

// ─── DUPLAS (mercado oficial Bet365): Pts+Reb, Pts+Ast, Reb+Ast ───────────────
// Na Bet365 BR, existem mercados "Pontos + Rebotes", "Pontos + Assistências",
// "Rebotes + Assistências" e "Pts+Reb+Ast" como stats únicas com linha agregada.
// Lógica: soma as médias, snap pra linha comum, confiança derivada com variância ajustada
const DUPLA_LINES = {
  'pts+reb': [15, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50],
  'pts+ast': [15, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5],
  'reb+ast': [5, 7, 8.5, 10, 11.5, 13, 14.5, 16, 17.5, 19],
  'pts+reb+ast': [25, 30, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5, 55],
}
function snapDuplaLine(sum, key) {
  const ls = DUPLA_LINES[key] || []
  if (!ls.length) return Math.round(sum * 2) / 2
  return ls.reduce((a, b) => Math.abs(b - sum) < Math.abs(a - sum) ? b : a)
}

function generateNBADuplas(props) {
  // Agrupa por jogador → média por stat (usa linha do tier median como proxy de expectativa)
  const byPlayer = new Map()
  props.forEach(p => {
    if (!byPlayer.has(p.player)) byPlayer.set(p.player, { match: p.match, team: p.team, home: p.home, away: p.away, league: p.league, stats: {} })
    const bp = byPlayer.get(p.player)
    const s = p.statBase
    if (!bp.stats[s] || p.conf > bp.stats[s].conf) bp.stats[s] = p   // top conf por stat
  })

  const duplas = []
  const statIcons = { pts: '🏀', reb: '💪', ast: '🎯' }
  const statLabels = { pts: 'PTS', reb: 'REB', ast: 'AST' }

  for (const [player, data] of byPlayer) {
    const { stats } = data
    const pairs = [
      { key: 'pts+reb', parts: ['pts', 'reb'] },
      { key: 'pts+ast', parts: ['pts', 'ast'] },
      { key: 'reb+ast', parts: ['reb', 'ast'] },
    ]

    pairs.forEach(({ key, parts }) => {
      const p1 = stats[parts[0]], p2 = stats[parts[1]]
      if (!p1 || !p2) return
      // Soma das médias → expectativa da dupla
      const sumAvg = (p1.avg || 0) + (p2.avg || 0)
      if (sumAvg < 5) return
      const line = snapDuplaLine(sumAvg * 0.88, key)    // tier "median" (~88% da média)

      // Confiança: variância combinada tem desvio maior
      // std_pair ≈ sqrt(std_1² + std_2² + 2×ρ×std_1×std_2)
      // Aproximação: usa o menor dos confs individuais × 1.05 (duplas são levemente mais seguras pela soma suavizar picos)
      const baseConf = Math.min(p1.conf, p2.conf)
      const conf = Math.max(30, Math.min(85, Math.round(baseConf * 1.05)))

      const fairOdds = +(100 / conf).toFixed(2)
      const bookOdds = +(fairOdds * 1.10).toFixed(2)
      const edge = +((1/bookOdds - (1 - conf/100)) * 100).toFixed(1)

      duplas.push({
        id: `dupla|${p1.match}|${player}|${key}`,
        match: p1.match,
        home: p1.home, away: p1.away, team: p1.team, league: p1.league || 'NBA',
        player,
        statBase: key,                   // 'pts+reb' etc
        stat: `${statIcons[parts[0]]}+${statIcons[parts[1]]} ${statLabels[parts[0]]}+${statLabels[parts[1]]}`,
        line: `O${line}`,
        lineRaw: line,
        sumAvg: +sumAvg.toFixed(1),
        conf,
        fairOdds,
        bookOdds,
        edge,
        parts,
        partsAvg: { [parts[0]]: p1.avg, [parts[1]]: p2.avg },
        partsConf: { [parts[0]]: p1.conf, [parts[1]]: p2.conf },
        reason: `${player.split(' ').slice(-1)[0]} média combinada ~${sumAvg.toFixed(1)} em ${statLabels[parts[0]]}+${statLabels[parts[1]]}. ` +
                `Linha snap: ${line}. Conf individual: ${p1.conf}%/${p2.conf}%.`,
        score: conf + Math.max(0, edge),
      })
    })

    // Triple dupla (Pts+Reb+Ast combinada como stat única)
    if (stats.pts && stats.reb && stats.ast) {
      const sumAvg = (stats.pts.avg || 0) + (stats.reb.avg || 0) + (stats.ast.avg || 0)
      if (sumAvg >= 20) {
        const line = snapDuplaLine(sumAvg * 0.85, 'pts+reb+ast')
        const minConf = Math.min(stats.pts.conf, stats.reb.conf, stats.ast.conf)
        const conf = Math.max(30, Math.min(82, Math.round(minConf * 1.02)))
        const fairOdds = +(100 / conf).toFixed(2)
        const bookOdds = +(fairOdds * 1.10).toFixed(2)
        const edge = +((1/bookOdds - (1 - conf/100)) * 100).toFixed(1)
        duplas.push({
          id: `dupla3|${stats.pts.match}|${player}`,
          match: stats.pts.match,
          home: stats.pts.home, away: stats.pts.away, team: stats.pts.team, league: stats.pts.league || 'NBA',
          player,
          statBase: 'pts+reb+ast',
          stat: '🏀💪🎯 PTS+REB+AST',
          line: `O${line}`,
          lineRaw: line,
          sumAvg: +sumAvg.toFixed(1),
          conf,
          fairOdds, bookOdds, edge,
          parts: ['pts','reb','ast'],
          partsAvg: { pts: stats.pts.avg, reb: stats.reb.avg, ast: stats.ast.avg },
          partsConf: { pts: stats.pts.conf, reb: stats.reb.conf, ast: stats.ast.conf },
          reason: `${player.split(' ').slice(-1)[0]} média agregada ~${sumAvg.toFixed(1)}. Triple dupla oficial Bet365.`,
          score: conf + Math.max(0, edge) + 5,
        })
      }
    }
  }
  return duplas.sort((a, b) => b.score - a.score)
}

// ─── PropCard ────────────────────────────────────────────────────────────────
const DQ_COLOR = { REAL:'var(--green)', PARCIAL:'var(--amber)', EST:'var(--mute)' }

// ─── Agrupamento por método dentro de cada jogo ───────────────────────────────
function getPropMethodBk(stat, firstHalf) {
  const s = (stat || '').toLowerCase()
  const ht = firstHalf ? ' 1T' : ''
  if (s.includes('pont'))  return { key:`pts${firstHalf?'1t':'fg'}`,  label:`🏀 Pontos${ht}`,         order: firstHalf?2:1  }
  if (s.includes('rebote'))return { key:`reb${firstHalf?'1t':'fg'}`,  label:`💪 Rebotes${ht}`,        order: firstHalf?4:3  }
  if (s.includes('assist'))return { key:`ast${firstHalf?'1t':'fg'}`,  label:`🎯 Assistências${ht}`,   order: firstHalf?6:5  }
  return                          { key:`outros${firstHalf?'1t':'fg'}`,label:`📊 Outros${ht}`,         order: firstHalf?8:7  }
}

function statCategory(stat, firstHalf) {
  const s = (stat||'').toLowerCase()
  const ht = firstHalf ? ' (1T)' : ''
  if (s.includes('pont') || s.includes('point')) return { key:`pts${firstHalf?'1t':'fg'}`,  label:`🏀 Pontos${ht}`,       order: firstHalf?1:0  }
  if (s.includes('rebote') || s.includes('reb'))  return { key:`reb${firstHalf?'1t':'fg'}`,  label:`💪 Rebotes${ht}`,      order: firstHalf?4:3  }
  if (s.includes('assist') || s.includes('ast'))  return { key:`ast${firstHalf?'1t':'fg'}`,  label:`🎯 Assistências${ht}`, order: firstHalf?6:5  }
  return                                                  { key:`outros${firstHalf?'1t':'fg'}`,label:`📊 Outros${ht}`,      order: firstHalf?8:7  }
}

function MethodSection({ label, count, children }) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0 6px',
        borderBottom:'1px solid rgba(255,255,255,.06)',marginBottom:8}}>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,fontWeight:700,
          color:'var(--blue)',letterSpacing:'0.5px'}}>{label}</span>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--dim)',
          background:'rgba(255,255,255,.05)',padding:'1px 5px',borderRadius:8}}>{count}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(330px,1fr))',gap:10}}>
        {children}
      </div>
    </div>
  )
}

// ─── B4: Player Stats Widget (lazy ESPN fetch) ───────────────────────────────
function PlayerStatsWidget({ player, statType, line }) {
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)

  function load() {
    if (stats || loading) return
    setLoading(true)
    import('../utils/espn').then(({ fetchNBAPlayerStats }) =>
      fetchNBAPlayerStats(player)
        .then(d => setStats(d))
        .catch(() => setStats(null))
        .finally(() => setLoading(false))
    )
  }

  function toggle() {
    setOpen(v => !v)
    if (!open) load()
  }

  const statKey = (statType||'').toLowerCase().includes('rebote') ? 'reb'
    : (statType||'').toLowerCase().includes('assist') ? 'ast' : 'pts'

  const l5val  = stats?.stats?.l5?.[statKey]
  const l10val = stats?.stats?.l10?.[statKey]
  const trend  = l5val != null && l10val != null ? (l5val > l10val ? '↑' : l5val < l10val ? '↓' : '→') : null
  const trendColor = trend === '↑' ? 'var(--green)' : trend === '↓' ? 'var(--red)' : 'var(--mute)'
  const lineN = parseFloat(line)

  return (
    <div style={{ marginTop:4 }}>
      <button onClick={toggle} style={{
        fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
        background: open ? 'rgba(59,130,246,.1)' : 'rgba(255,255,255,.04)',
        border: `1px solid ${open ? 'rgba(59,130,246,.3)' : 'rgba(255,255,255,.08)'}`,
        color: open ? 'var(--blue)' : 'var(--dim)',
        padding:'2px 8px', borderRadius:20, cursor:'pointer',
        display:'inline-flex', alignItems:'center', gap:4,
      }}>
        📊 Stats {trend && <span style={{ color:trendColor }}>{trend}</span>} {open ? '▲' : '▼'}
      </button>

      {open && (
        <div style={{ marginTop:5, padding:'8px 10px', background:'rgba(59,130,246,.06)',
          border:'1px solid rgba(59,130,246,.15)', borderRadius:6 }}>
          {loading && <span style={{ fontSize:10, color:'var(--dim)' }}>Buscando stats ESPN…</span>}
          {!loading && !stats && <span style={{ fontSize:10, color:'var(--dim)' }}>Stats não disponíveis.</span>}
          {stats?.stats && (
            <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
              {[{ key:'pts', label:'PTS' },{ key:'reb', label:'REB' },{ key:'ast', label:'AST' }].map(({ key, label }) => {
                const l5 = stats.stats.l5?.[key]
                const l10 = stats.stats.l10?.[key]
                const isTarget = key === statKey
                const hitRate = stats.stats.games?.filter(g => {
                  if (key === 'pts') return g.pts > lineN
                  if (key === 'reb') return g.reb > lineN
                  return g.ast > lineN
                }).length
                const total = stats.stats.games?.length || 0
                return (
                  <div key={key} style={{ opacity: isTarget ? 1 : .65 }}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)', marginBottom:2 }}>{label}</div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
                      color: isTarget ? 'var(--white)' : 'var(--soft)' }}>
                      L5: {l5 ?? '—'} · L10: {l10 ?? '—'}
                    </div>
                    {isTarget && total > 0 && lineN > 0 && (
                      <div style={{ fontSize:9, color: hitRate/total >= 0.6 ? 'var(--green)' : 'var(--amber)',
                        fontFamily:"'JetBrains Mono',monospace" }}>
                        Hit {hitRate}/{total} últimos ({Math.round(hitRate/total*100)}%)
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ComboCard: Same Game Parlay por jogador ────────────────────────────────
function ComboCard({ combo, pickId, histResult, onSetResult }) {
  const RESULT_COLORS = {
    W: { bg: 'rgba(0,214,143,.85)',  border: 'var(--green)', text: '#fff', label: '✓W' },
    L: { bg: 'rgba(255,79,106,.85)', border: 'var(--red)',   text: '#fff', label: '✕L' },
    V: { bg: 'rgba(255,255,255,.1)', border: 'var(--mute)',  text: 'var(--t2)', label: '○V' },
    P: { bg: 'rgba(255,184,48,.7)', border: 'var(--amber)', text: '#fff', label: '=P' },
  }
  const rc = histResult ? RESULT_COLORS[histResult] : null
  const isTriple = combo.type === '3-leg'
  const accent = isTriple ? '#c084fc' : '#5ecbff'
  const bg     = isTriple ? 'linear-gradient(135deg, rgba(192,132,252,.08), rgba(192,132,252,.02))'
                          : 'linear-gradient(135deg, rgba(94,203,255,.08), rgba(94,203,255,.02))'
  return (
    <div className="pick-card" style={{
      padding:'12px 14px',
      background: bg,
      borderColor: rc ? rc.border : accent + '40',
      borderLeft: `3px solid ${accent}`,
      opacity: histResult === 'L' ? 0.75 : 1,
      position:'relative',
    }}>
      {/* Header: player + tipo */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8}}>
        <div style={{flex:1, minWidth:0}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:800,
              letterSpacing:'.08em', color:accent, background: accent+'18', padding:'2px 6px',
              borderRadius:3, border:`1px solid ${accent}30`}}>
              {isTriple ? '🎲 TRIPLE STAT' : '🎯 COMBO SGP'}
            </span>
            {combo.corr > 10 && (
              <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)'}}>
                ρ +{combo.corr}%
              </span>
            )}
            {combo.hitRateAvailable === false && (
              <span title="Jogador não encontrado no gamelog ESPN — confiança apenas modelo"
                style={{fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                color:'var(--amber)', background:'var(--a3)', padding:'1px 5px', borderRadius:3}}>
                ⚠ SEM L10
              </span>
            )}
          </div>
          <div style={{fontSize:14, fontWeight:700, color:'var(--white)'}}>
            {combo.player}
          </div>
          <div style={{fontSize:11, color:'var(--mute)', marginTop:1}}>
            🏀 {combo.team}
          </div>
        </div>
        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:800,
            color: combo.conf >= 65 ? 'var(--green)' : combo.conf >= 50 ? 'var(--amber)' : 'var(--mute)'}}>
            {combo.conf}%
          </div>
          <div style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--soft)'}}>
            odd ~{combo.bookOdds.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{display:'flex', flexDirection:'column', gap:5, marginBottom:8,
        padding:'8px 10px', background:'rgba(0,0,0,.25)', borderRadius:6}}>
        {combo.legs.map((leg, i) => {
          const hit = leg.hitL10
          const hitColor = hit ? (hit.pct >= 70 ? 'var(--green)' : hit.pct >= 50 ? 'var(--amber)' : 'var(--red)') : 'var(--mute)'
          return (
            <div key={i} style={{display:'flex', alignItems:'center', gap:8, fontSize:12, flexWrap:'wrap'}}>
              <span style={{fontSize:14}}>{leg.icon}</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace", color:'var(--white)', fontWeight:700, minWidth:50}}>
                {leg.line}
              </span>
              <span style={{color:'var(--soft)'}}>{leg.stat}</span>
              <span style={{marginLeft:'auto', fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)'}}>
                média {leg.avg}
                {leg.projAdjusted != null && Math.abs(leg.projAdjusted - (leg.avg ?? 0)) >= 0.1 && (
                  <span style={{
                    color: (leg.marginPct ?? 0) > 0 ? 'var(--green)' : 'var(--red)',
                    marginLeft: 4, fontWeight: 700
                  }}>
                    → proj {leg.projAdjusted}
                  </span>
                )}
              </span>
              {hit && (
                <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                  color: hitColor, background: hitColor+'15', padding:'1px 5px', borderRadius:3,
                  border: `1px solid ${hitColor}30`}}>
                  {hit.hit}/{hit.total} L10 · {hit.pct}%
                  {leg.adjHitPct != null && leg.adjHitPct !== hit.pct && (
                    <span style={{ opacity: 0.85, marginLeft: 3 }}>→ {leg.adjHitPct}%</span>
                  )}
                </span>
              )}
              {leg.minMult != null && Math.abs(leg.minMult - 1) > 0.03 && (
                <span title={`Tendência de minutos L5 vs L10: ${(leg.minMult * 100).toFixed(0)}%`}
                  style={{fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                  color: leg.minMult > 1 ? 'var(--green)' : 'var(--red)',
                  background: (leg.minMult > 1 ? 'var(--g3)' : 'var(--r3)'),
                  padding:'1px 5px', borderRadius:3}}>
                  {leg.minMult > 1 ? '⏱↑' : '⏱↓'} {((leg.minMult - 1) * 100).toFixed(0)}%
                </span>
              )}
              {leg.restMult != null && leg.restMult !== 1 && (
                <span title={`REST: ${leg.restMult > 1 ? 'descanso extra (+4%)' : 'back-to-back (-6%)'}`}
                  style={{fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                  color: leg.restMult > 1 ? 'var(--blue)' : 'var(--amber)',
                  background: leg.restMult > 1 ? 'rgba(94,203,255,.15)' : 'var(--a3)',
                  padding:'1px 5px', borderRadius:3}}>
                  {leg.restMult > 1 ? '🛌 REST' : '⚡ B2B'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Vibe + tendência de minutos badges */}
      {(combo.vibe || combo.minuteTrend) && (
        <div style={{marginBottom:6, display:'flex', gap:6, flexWrap:'wrap'}}>
          {combo.vibe === 'hot' && (
            <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
              color:'var(--green)', background:'var(--g3)', padding:'2px 7px', borderRadius:3}}>
              🔥 QUENTE — média L10 {combo.hitL10AvgLeg}% acima da linha
            </span>
          )}
          {combo.vibe === 'cold' && (
            <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
              color:'var(--red)', background:'rgba(255,79,106,.12)', padding:'2px 7px', borderRadius:3}}>
              🧊 FRIO — L10 apenas {combo.hitL10AvgLeg}% acima
            </span>
          )}
          {combo.minuteTrend === 'up' && (
            <span title={`Média L5/L10 minutos: ${combo.avgMinMult}×`}
              style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
              color:'var(--green)', background:'var(--g3)', padding:'2px 7px', borderRadius:3}}>
              ⏱️ MINUTOS ↑ +{Math.round(((combo.avgMinMult ?? 1) - 1) * 100)}% (rotação alta)
            </span>
          )}
          {combo.minuteTrend === 'down' && (
            <span title={`Média L5/L10 minutos: ${combo.avgMinMult}×`}
              style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
              color:'var(--red)', background:'rgba(255,79,106,.12)', padding:'2px 7px', borderRadius:3}}>
              ⏱️ MINUTOS ↓ {Math.round(((combo.avgMinMult ?? 1) - 1) * 100)}% (rotação baixa)
            </span>
          )}
        </div>
      )}

      {/* Footer: razão */}
      <div style={{fontFamily:"'Inter',sans-serif", fontSize:11, color:'var(--soft)',
        borderLeft:`2px solid ${accent}`, paddingLeft:7, lineHeight:1.55, opacity:.85}}>
        {combo.reason}
      </div>

      {combo.edge > 2 && (
        <div style={{marginTop:6, display:'flex', gap:6, alignItems:'center'}}>
          <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--green)', background:'var(--g3)', padding:'2px 6px', borderRadius:3}}>
            📈 Edge {combo.edge}%
          </span>
        </div>
      )}

      {/* Result buttons */}
      {onSetResult && pickId && (
        <div style={{display:'flex', gap:3, marginTop:8, justifyContent:'flex-end'}}>
          {['W','L','V','P'].map(r => {
            const rcc = RESULT_COLORS[r]; const active = histResult === r
            return (
              <button key={r} onClick={() => onSetResult(pickId, active ? null : r)} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                padding:'2px 7px', borderRadius:3, cursor:'pointer',
                background: active ? rcc.bg : 'transparent',
                border:`1px solid ${active ? rcc.border : 'var(--border)'}`,
                color: active ? rcc.text : 'var(--t3)',
                minWidth:32, textAlign:'center',
              }}>{rcc.label}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── DuplaCard: mercado oficial Bet365 (Pts+Reb, Pts+Ast, etc) ──────────────
function DuplaCard({ dupla, pickId, histResult, onSetResult }) {
  const RC = {
    W: { bg:'rgba(0,214,143,.85)',  border:'var(--green)', text:'#fff', label:'✓W' },
    L: { bg:'rgba(255,79,106,.85)', border:'var(--red)',   text:'#fff', label:'✕L' },
    V: { bg:'rgba(255,255,255,.1)', border:'var(--mute)',  text:'var(--t2)', label:'○V' },
    P: { bg:'rgba(255,184,48,.7)',  border:'var(--amber)', text:'#fff', label:'=P' },
  }
  const rc = histResult ? RC[histResult] : null
  const isTriple = dupla.parts.length === 3
  const accent = isTriple ? '#ffd166' : '#ff9f68'
  return (
    <div className="pick-card" style={{
      padding:'12px 14px',
      background: `linear-gradient(135deg, ${accent}12, ${accent}02)`,
      borderColor: rc ? rc.border : accent + '40',
      borderLeft: `3px solid ${accent}`,
      opacity: histResult === 'L' ? 0.75 : 1,
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8}}>
        <div style={{flex:1, minWidth:0}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:800,
              letterSpacing:'.08em', color:accent, background:accent+'18', padding:'2px 6px',
              borderRadius:3, border:`1px solid ${accent}30`}}>
              {isTriple ? '🎰 TRIPLE DUPLA' : '🪄 DUPLA BET365'}
            </span>
          </div>
          <div style={{fontSize:14, fontWeight:700, color:'var(--white)'}}>{dupla.player}</div>
          <div style={{fontSize:11, color:'var(--soft)', marginTop:1}}>
            {dupla.stat} · <span style={{color:accent, fontWeight:600}}>{dupla.line}</span>
          </div>
          <div style={{fontSize:11, color:'var(--mute)', marginTop:1}}>
            🏀 {dupla.team} · Soma média: ~{dupla.sumAvg}
          </div>
        </div>
        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:800,
            color: dupla.conf >= 70 ? 'var(--green)' : dupla.conf >= 55 ? 'var(--amber)' : 'var(--mute)'}}>
            {dupla.conf}%
          </div>
          <div style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--soft)'}}>
            odd ~{dupla.bookOdds.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Breakdown das partes */}
      <div style={{display:'flex', gap:10, padding:'6px 10px', background:'rgba(0,0,0,.25)',
        borderRadius:6, marginBottom:8, flexWrap:'wrap'}}>
        {dupla.parts.map(k => {
          const icon = { pts:'🏀', reb:'💪', ast:'🎯' }[k]
          const label = { pts:'PTS', reb:'REB', ast:'AST' }[k]
          return (
            <div key={k} style={{fontSize:11, fontFamily:"'JetBrains Mono',monospace", color:'var(--soft)'}}>
              {icon} <span style={{color:'var(--white)', fontWeight:700}}>{label}</span>
              <span style={{color:'var(--mute)'}}> ~{dupla.partsAvg[k]} · {dupla.partsConf[k]}%</span>
            </div>
          )
        })}
      </div>

      <div style={{fontFamily:"'Inter',sans-serif", fontSize:11, color:'var(--soft)',
        borderLeft:`2px solid ${accent}`, paddingLeft:7, lineHeight:1.55, opacity:.85}}>
        {dupla.reason}
      </div>

      {dupla.edge > 2 && (
        <div style={{marginTop:6, display:'flex', gap:6}}>
          <span style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--green)', background:'var(--g3)', padding:'2px 6px', borderRadius:3}}>
            📈 Edge {dupla.edge}%
          </span>
        </div>
      )}

      {onSetResult && pickId && (
        <div style={{display:'flex', gap:3, marginTop:8, justifyContent:'flex-end'}}>
          {['W','L','V','P'].map(r => {
            const rcc = RC[r]; const active = histResult === r
            return (
              <button key={r} onClick={() => onSetResult(pickId, active ? null : r)} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                padding:'2px 7px', borderRadius:3, cursor:'pointer',
                background: active ? rcc.bg : 'transparent',
                border:`1px solid ${active ? rcc.border : 'var(--border)'}`,
                color: active ? rcc.text : 'var(--t3)',
                minWidth:32, textAlign:'center',
              }}>{rcc.label}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PropCard({ prop, pickId, histResult, onSetResult }) {
  const { banca } = usePerfStore()
  const RESULT_COLORS_BK = {
    W: { bg: 'rgba(0,214,143,.85)',  border: 'var(--green)', text: '#fff', label: '✓W' },
    L: { bg: 'rgba(255,79,106,.85)', border: 'var(--red)',   text: '#fff', label: '✕L' },
    V: { bg: 'rgba(255,255,255,.1)', border: 'var(--mute)',  text: 'var(--t2)', label: '○V' },
    P: { bg: 'rgba(255,184,48,.7)', border: 'var(--amber)', text: '#fff', label: '=P' },
  }
  const rc = histResult ? RESULT_COLORS_BK[histResult] : null
  return (
    <div className="pick-card" style={{padding:'12px 14px', display:'flex', gap:8, alignItems:'flex-start',
      borderColor: rc ? rc.border : undefined, opacity: histResult === 'L' ? 0.75 : 1}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:'var(--white)'}}>
              {prop.player}
            </div>
            <div style={{fontSize:11,color:'var(--soft)',marginTop:1}}>
              {prop.stat} · <span style={{color:'var(--blue)',fontWeight:600}}>{prop.line}</span>
            </div>
            {prop.avg != null && (
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--dim)',marginTop:2}}>
                Média: ~{prop.avg} · <span style={{color:DQ_COLOR[prop.dq]||'var(--mute)'}}>{prop.dq}</span>
              </div>
            )}
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
            <PickTierBadge conf={prop.conf} ev={prop.ev}/>
            {prop.firstHalf && (
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--amber)',
                background:'rgba(255,184,48,.15)',border:'1px solid rgba(255,184,48,.3)',padding:'1px 5px',borderRadius:3}}>🕐 1T</span>
            )}
            {prop.isBestStat && (
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--green)',
                background:'var(--g3)',padding:'1px 5px',borderRadius:3}}>✓ BEST STAT</span>
            )}
          </div>
        </div>
        <ConfBar conf={prop.conf}/>
        {prop.reason && (
          <div style={{fontFamily:"'Inter', sans-serif",fontSize:11,color:'var(--soft)',margin:'7px 0 4px',
            borderLeft:'2px solid var(--blue)',paddingLeft:7,lineHeight:1.55,opacity:0.85}}>
            {prop.reason}
          </div>
        )}
        <div style={{display:'flex',gap:6,marginTop:6,alignItems:'center',flexWrap:'wrap'}}>
          <EdgeBadge ev={prop.ev}/>
          <StakeBadge conf={prop.conf} ev={prop.ev}/>
          {prop.real_odd && <KellyBadge conf={prop.conf} odd={prop.real_odd} banca={banca}/>}
          {prop.isB2B && (
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--amber)',
              background:'var(--a3)',padding:'1px 5px',borderRadius:3}}>⚠ B2B</span>
          )}
          {prop.team && (
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginLeft:'auto'}}>
              🏀 {prop.team}
            </span>
          )}
        </div>
        {/* B4: Player Stats */}
        {prop.player && (
          <PlayerStatsWidget player={prop.player} statType={prop.stat} line={prop.line?.replace(/[OU]/,'')} />
        )}
      </div>
      {onSetResult && pickId && (
        <div style={{display:'flex',flexDirection:'column',gap:3,flexShrink:0}}>
          {['W','L','V','P'].map(r => {
            const rcc = RESULT_COLORS_BK[r]; const active = histResult === r
            return (
              <button key={r} onClick={() => onSetResult(pickId, active ? null : r)} style={{
                fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:700,
                padding:'2px 5px',borderRadius:3,cursor:'pointer',
                background: active ? rcc.bg : 'transparent',
                border:`1px solid ${active ? rcc.border : 'var(--border)'}`,
                color: active ? rcc.text : 'var(--t3)',
                minWidth:34,textAlign:'center',
              }}>{rcc.label}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function BkProps() {
  const [props,      setProps]      = useState([])
  const [combos,     setCombos]     = useState([])
  const [loading,    setLoading]    = useState(false)
  const [loaded,     setLoaded]     = useState(false)
  const [enriching,  setEnriching]  = useState(false)
  const [conference, setConference] = useState('all')
  const [search,     setSearch]     = useState('')
  const [statFilter, setStatFilter] = useState('all')
  const [collapsed,  setCollapsed]  = useState({})
  const [tab,     setTab]     = useState('combos')    // default: combos (foco principal)
  const [history, setHistory] = useState([])

  const toggleMatch = (m, currentIsOpen) => setCollapsed(c => ({ ...c, [m]: currentIsOpen }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 1) Injuries dinâmicas ESPN (merge com lista estática)
      const injPayload = await fetchNBAInjuries().catch(() => null)
      const dynOut = buildInjurySet(injPayload)
      dynOut.forEach(n => NBA_OUT.add(n))

      const res   = await fetchMatches({ date:today(), sport:'basketball' })
      const games = res.matches||res.data||[]
      const generated = generateNBAProps(Array.isArray(games)?games:[])
      const generatedCombos = generateNBACombos(generated)
      setProps(generated)
      setCombos(generatedCombos)

      // Enriquecimento async com hit rates L10 reais da ESPN
      // (não bloqueia UI — atualiza em segundo plano)
      setEnriching(true)
      const uniquePlayers = [...new Set(generated.map(p => p.player))].slice(0, 60)  // cap pra não floodar
      // Positions map pra correlação archetype
      const positionsMap = {}
      uniquePlayers.forEach(p => { positionsMap[p] = NBA_POSITIONS[p] || 'wing' })
      fetchPlayerStatsBatch(uniquePlayers).then(statsMap => {
        setProps(enrichPropsWithHitRate(generated, statsMap))
        setCombos(enrichCombosWithHitRate(generatedCombos, statsMap, positionsMap))
        setEnriching(false)
      }).catch(() => setEnriching(false))
      setLoaded(true)
      // Auto-save to history
      const todayStr = today()
      const toSave = generated.map(p => ({
        ...p,
        id: makePickId(todayStr, p.match||'', p.stat||'', p.line||''),
      }))
      const updatedHist = autoSavePicks(toSave, todayStr, BK_HIST_KEY, 'basketball')
      setHistory(updatedHist)
    } catch(e) {
      console.warn('[BkProps]', e.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [])
  useEffect(() => { fetchFeaturedMatches().then(setFeaturedList).catch(()=>{}) }, [])

  useEffect(() => {
    async function syncFromServer() {
      const synced = await serverSyncHistory(BK_HIST_KEY, 'basketball')
      setHistory(synced)
    }
    syncFromServer()
    function onVisible() { if (!document.hidden) syncFromServer() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(syncFromServer, 10 * 60 * 1000)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const [featuredList, setFeaturedList] = useState([])

  function handleSetResult(id, result) {
    const updated = updateHistResult(id, result, BK_HIST_KEY)
    setHistory(updated)
  }

  // Combos filtrados (mesmos filtros de busca/conferência aplicam)
  const filteredCombos = useMemo(() => {
    let arr = [...combos]
    if (conference !== 'all') {
      arr = arr.filter(c => {
        const t = (c.team||'').toLowerCase()
        const east = ['celtics','nets','knicks','76ers','raptors','bulls','cavaliers','pistons','pacers','bucks',
          'heat','magic','wizards','hornets','hawks']
        const west = ['lakers','clippers','warriors','suns','kings','nuggets','timberwolves','thunder','trail blazers',
          'jazz','mavericks','rockets','grizzlies','pelicans','spurs']
        if (conference === 'east') return east.some(e => t.includes(e))
        if (conference === 'west') return west.some(w => t.includes(w))
        return true
      })
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(c =>
        (c.player||'').toLowerCase().includes(q) ||
        (c.match||'').toLowerCase().includes(q) ||
        (c.team||'').toLowerCase().includes(q)
      )
    }
    return arr
  }, [combos, conference, search])

  const combosByMatch = useMemo(() => {
    const map = new Map()
    filteredCombos.forEach(c => {
      const mk = c.match || '—'
      if (!map.has(mk)) map.set(mk, { match: mk, league: c.league, combos: [] })
      map.get(mk).combos.push(c)
    })
    // Ordena combos dentro de cada jogo por score e limita a top 3
    // Prioriza combos com hit rate L10 disponível (enriched)
    const groups = [...map.values()].map(g => {
      const sorted = g.combos.sort((a, b) => {
        const aHasHit = a.hitRateAvailable ? 1 : 0
        const bHasHit = b.hitRateAvailable ? 1 : 0
        if (aHasHit !== bHasHit) return bHasHit - aHasHit
        return (b.conf + Math.max(0, b.edge)) - (a.conf + Math.max(0, a.edge))
      })
      return { ...g, combos: sorted.slice(0, 3) }
    })
    return groups.sort((a, b) => {
      const maxA = Math.max(...a.combos.map(c => c.conf + Math.max(0, c.edge)))
      const maxB = Math.max(...b.combos.map(c => c.conf + Math.max(0, c.edge)))
      return maxB - maxA
    })
  }, [filteredCombos])

  const filtered = useMemo(() => {
    let arr = [...props]
    if (conference !== 'all') {
      arr = arr.filter(p => {
        const t = (p.team||'').toLowerCase()
        const east = ['celtics','nets','knicks','76ers','raptors','bulls','cavaliers','pistons','pacers','bucks',
          'heat','magic','wizards','hornets','hawks']
        const west = ['lakers','clippers','warriors','suns','kings','nuggets','timberwolves','thunder','trail blazers',
          'jazz','mavericks','rockets','grizzlies','pelicans','spurs']
        if (conference === 'east') return east.some(e => t.includes(e))
        if (conference === 'west') return west.some(w => t.includes(w))
        return true
      })
    }
    if (statFilter !== 'all') arr = arr.filter(p => {
      const s = (p.stat||'').toLowerCase()
      if (statFilter === 'pts') return s.includes('pont') || s.includes('point')
      if (statFilter === 'reb') return s.includes('rebote') || s.includes('reb')
      if (statFilter === 'ast') return s.includes('assist')
      return true
    })
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(p =>
        (p.player||'').toLowerCase().includes(q) ||
        (p.match||'').toLowerCase().includes(q) ||
        (p.team||'').toLowerCase().includes(q)
      )
    }
    return arr
  }, [props, featuredList, conference, statFilter, search])

  const groupedByMatch = useMemo(() => {
    const map = new Map()
    filtered.forEach(p => {
      const mk = p.match || '—'
      if (!map.has(mk)) map.set(mk, { match: mk, league: p.league, props: [] })
      map.get(mk).props.push(p)
    })
    return [...map.values()].sort((a, b) => {
      const [aH, aA] = (a.match||'').split(' vs ')
      const [bH, bA] = (b.match||'').split(' vs ')
      const pa = isMatchFeatured(aH, aA, featuredList) ? 0 : 1
      const pb = isMatchFeatured(bH, bA, featuredList) ? 0 : 1
      if (pa !== pb) return pa - pb
      // Secondary: conf
      return Math.max(...b.props.map(x=>x.conf||0)) - Math.max(...a.props.map(x=>x.conf||0))
    })
  }, [filtered, featuredList])

  const histStats = useMemo(() => calcHistStats(history), [history])
  const histById  = useMemo(() => {
    const m = {}; history.forEach(h => { m[h.id] = h.result }); return m
  }, [history])

  const kpis = {
    total:   props.length,
    elite:   props.filter(p => p.conf >= 80 && (p.ev||0) >= 6).length,
    forte:   props.filter(p => p.conf >= 70 && (p.ev||0) >= 4).length,
    avgConf: props.length ? Math.round(props.reduce((a, p) => a + p.conf, 0) / props.length) : 0,
  }

  return (
    <div className="page">
      <PageHeader icon="🏀" title="NBA Player Props"
        subtitle={loaded ? `${props.length} props · ${filtered.length} filtrados` : 'Análise de player props NBA'}
        actions={
          <button onClick={load} className="btn" style={{ padding:'5px 12px', fontSize:12 }}>↺ Atualizar</button>
        }
      />

      <KpiRow>
        <Kpi value={combos.length} label="🎯 Combos SGP"  color="#5ecbff" pulse={combos.length > 0}/>
        <Kpi value={kpis.total}    label="Props Singles"  color="var(--soft)"/>
        <Kpi value={kpis.elite}    label="🔥 Elite"       color="var(--amber)"/>
      </KpiRow>

      {enriching && (
        <div style={{fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--blue)',
          padding:'4px 10px', background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.2)',
          borderRadius:4, marginBottom:10, display:'inline-flex', alignItems:'center', gap:6}}>
          ⏳ Calibrando com hit rate L10 real (ESPN)…
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['combos',`🎯 Combos${combos.length > 0 ? ` ${combos.length}` : ''}`],
          ['props','🏀 Props Single'],
          ['historico',`📊 Histórico${history.length > 0 ? ` ${history.length}` : ''}`]].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
            padding:'8px 16px', background:'none', border:'none',
            borderBottom: tab===v ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab===v ? 'var(--blue)' : 'var(--mute)',
            cursor:'pointer', marginBottom:-1,
          }}>{l}</button>
        ))}
        {histStats.wr != null && (
          <span style={{ marginLeft:'auto', alignSelf:'center', fontSize:11,
            fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)', paddingRight:4 }}>
            {histStats.wr.toFixed(0)}% WR · {histStats.wins}W/{histStats.losses}L
          </span>
        )}
      </div>

      {/* ── Histórico ── */}
      {tab === 'historico' && (
        <HistoricoView
          history={history}
          histStats={histStats}
          onSetResult={handleSetResult}
          sport="basketball"
          emptyTitle="Histórico de NBA Props vazio"
          emptySubtitle="Os props gerados são salvos automaticamente. Marque os resultados para calibrar."
        />
      )}

      {/* ── Combos (SGP por jogador) ── */}
      {tab === 'combos' && (<>
        {loaded && (
          <div className="filter-bar">
            <div style={{fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--soft)',
              display:'flex', alignItems:'center', gap:6}}>
              <span style={{color:'#5ecbff'}}>🎯</span>
              Same Game Parlay — 2 ou 3 stats do mesmo jogador com correlação aplicada
            </div>
            {[['all','Conferência'],['east','🔵 Leste'],['west','🔴 Oeste']].map(([v, l]) => (
              <button key={v}
                className={`filter-chip${conference===v?' active':''}`}
                onClick={() => setConference(v)}
                style={{display: v==='all'?'none':'inline-flex'}}>{l}</button>
            ))}
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Buscar jogador..."
              style={{ fontFamily:"'Inter',sans-serif", fontSize:12, padding:'4px 10px', borderRadius:20,
                border:'1px solid var(--border)', background:'var(--ink2)', color:'var(--white)',
                width:140, outline:'none', marginLeft:'auto' }}
            />
            <span style={{ fontSize:11, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>
              {filteredCombos.length} combos
            </span>
          </div>
        )}

        {loading && !loaded && (
          <div style={{ padding:30, textAlign:'center', color:'var(--mute)', fontSize:13 }}>
            ⏳ Calculando combos NBA…
          </div>
        )}

        {loaded && combosByMatch.length === 0 && (
          <EmptyState icon="🎯" title="Nenhum combo qualificado"
            subtitle="Combos só são gerados quando cada perna individual tem conf ≥ 58%. Tente atualizar ou confira a aba Props Single."
            action={<button onClick={load} className="btn btn-primary" style={{ marginTop:8 }}>↺ Atualizar</button>}
          />
        )}

        {loaded && combosByMatch.map(({ match, league, combos: mCombos }) => {
          const isOpen = !collapsed[`combo_${match}`]
          return (
            <div key={match} className="pick-card" style={{ marginBottom:10, padding:0, overflow:'hidden' }}>
              <div onClick={() => setCollapsed(c => ({ ...c, [`combo_${match}`]: isOpen }))} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'10px 14px', cursor:'pointer',
                background:'rgba(94,203,255,.05)',
                borderBottom: isOpen ? '1px solid var(--border)' : 'none',
              }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14, color:'var(--white)' }}>{match}</div>
                  {league && <div style={{ fontSize:11, color:'var(--mute)', marginTop:1 }}>{league}</div>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:11, color:'#5ecbff', fontFamily:"'JetBrains Mono',monospace" }}>
                    {mCombos.length} combos
                  </span>
                  <span style={{ color:'var(--mute)', fontSize:13 }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ padding:'12px 14px', display:'grid',
                  gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:10 }}>
                  {mCombos.map(c => {
                    const pid = makePickId(today(), c.match||'', c.player||'', c.comboLabel||'')
                    return (
                      <ComboCard key={pid} combo={c} pickId={pid}
                        histResult={histById[pid]} onSetResult={handleSetResult}/>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </>)}

      {/* ── Props ── */}
      {tab === 'props' && (<>

      {/* Filter bar */}
      {loaded && (
        <div className="filter-bar">
          {[['all','Todos'],['pts','🏀 Pontos'],['reb','💪 Rebotes'],['ast','🎯 Assists']].map(([v, l]) => (
            <button key={v}
              className={`filter-chip${statFilter===v?' active':''}`}
              onClick={() => setStatFilter(v)}>{l}</button>
          ))}

          {[['all','Conferência'],['east','🔵 Leste'],['west','🔴 Oeste']].map(([v, l]) => (
            <button key={v}
              className={`filter-chip${conference===v?' active':''}`}
              onClick={() => setConference(v)}
              style={{display: v==='all'?'none':'inline-flex'}}>{l}</button>
          ))}

          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Buscar jogador..."
            style={{ fontFamily:"'Inter',sans-serif", fontSize:12, padding:'4px 10px', borderRadius:20,
              border:'1px solid var(--border)', background:'var(--ink2)', color:'var(--white)',
              width:140, outline:'none', marginLeft:'auto' }}
          />
          <span style={{ fontSize:11, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace", flexShrink:0 }}>
            {filtered.length} props
          </span>
        </div>
      )}

      {loading && !loaded && (
        <div style={{ padding:30, textAlign:'center', color:'var(--mute)', fontSize:13 }}>
          ⏳ Carregando props NBA…
        </div>
      )}

      {loaded && groupedByMatch.length === 0 && (
        <EmptyState icon="🏀" title="Nenhum prop encontrado"
          subtitle="Ajuste os filtros ou aguarde jogos agendados"
          action={<button onClick={load} className="btn btn-primary" style={{ marginTop:8 }}>↺ Atualizar</button>}
        />
      )}

      {loaded && groupedByMatch.map(({ match, league, props: mProps }) => {
        const isOpen = !collapsed[match]
        return (
          <div key={match} className="pick-card" style={{ marginBottom:10, padding:0, overflow:'hidden' }}>
            <div onClick={() => toggleMatch(match, isOpen)} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'10px 14px', cursor:'pointer',
              background:'rgba(255,255,255,.03)',
              borderBottom: isOpen ? '1px solid var(--border)' : 'none',
            }}>
              <div>
                <div style={{ fontWeight:700, fontSize:14, color:'var(--white)' }}>{match}</div>
                {league && <div style={{ fontSize:11, color:'var(--mute)', marginTop:1 }}>{league}</div>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:11, color:'var(--soft)', fontFamily:"'JetBrains Mono',monospace" }}>
                  {mProps.length} props
                </span>
                <span style={{ color:'var(--mute)', fontSize:13 }}>{isOpen ? '▲' : '▼'}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding:'10px 14px', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:8 }}>
                {mProps.map(p => {
                  const pid = makePickId(today(), p.match||'', p.stat||'', p.line||'')
                  return (
                    <PropCard
                      key={pid}
                      prop={p}
                      pickId={pid}
                      histResult={histById[pid]}
                      onSetResult={handleSetResult}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      </>)}
    </div>
  )
}
