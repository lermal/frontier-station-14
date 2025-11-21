const path = require("path");

// Script Made by Myzumi - POI Renderer
// Edit Variables here
const ShowContainerLogs = true; // Set to false to hide container logs
const POIPrototypePath = path.join(__dirname, "..", "..", "..", "Resources", "Prototypes", "_NF", "PointsOfInterest"); // Path to the POI prototype files
const POIMapPath = path.join(__dirname, "..", "..", "..", "Resources", "Maps", "_NF", "POI"); // Path to the POI map files
let MaxInstances = 2; // Maximum number of instances to run in parallel

// !! Do not edit below this line if you don't know what you're doing !!
// Developer Settings;
let Debug = true; // Set to true to enable debug mode, which will skip the 10 second wait and show more logs
const SkipBuild = false; // Set to true to skip the build process of the MapRenderer, Not Recommended due to the required Toolbox Fixes
//
const { exec } = require("child_process");
const { processRobustFiles } = require("./RobustToolboxFixes.js");
const fs = require("fs");
const YAML = require("yaml");
const chalk = require("chalk");
const Root = path.join(__dirname, "..", "..", "..");
const Logs = {}
let LockQueueClear = false;
const POIPaths = {}

// Серверные пути для сохранения данных
const WEB_POI_JSON = "/var/www/shipyard_fro_usr/data/www/shipyard.frontierstation14.com/storage/app/poi/poi_data.json";
const WEB_RENDERS_DIR = "/var/www/shipyard_fro_usr/data/www/shipyard.frontierstation14.com/public/images/renders";

let DevFilter = [] // This should not be used. Only for testing purposes.

let SucceedPOIs = [];
let EditedPOIs = [];
let FailedPOIs = [];

const Tags = {
  info: chalk.bgWhite("[INFO]") + " ",
  error: chalk.bgRed("[ERROR]") + " ",
  warning: chalk.bgYellow("[WARNING]") + " ",
  debug: chalk.bgRed("[DEBUG]") + " ",
};

console.log(chalk.bgBlue(chalk.white(`${chalk.bold("POI RENDERER:")} Starting Points of Interest rendering process!`)));
console.log(chalk.bgRed(chalk.yellow(`${chalk.bold("WARNING:")} This script will modify the RobustToolbox files!`)));
console.log(chalk.bgRed(chalk.yellow(`The Script will modify the EntityDeserializer.cs and MapLoaderSystem.Load.cs files!`)));
console.log(chalk.bgRed(chalk.yellow(`The Script will continue in 15 seconds. Press Ctrl+C to cancel.`)));

if (process.env.GITHUB_ACTIONS) {
  console.log(Tags.info + chalk.yellow(`This script is running in a GitHub Actions environment. Forcing Debug mode.`));
  Debug = true;
  MaxInstances = 1;
}
if (process.env.ENABLE_DEBUG) {
  console.log(Tags.info + chalk.yellow("Debug mode enabled by environment variable."));
  Debug = true;
}
if (process.env.MAX_INSTANCES) {
  console.log(Tags.info + chalk.yellow(`Max instances set to ${process.env.MAX_INSTANCES} by environment variable.`));
  MaxInstances = parseInt(process.env.MAX_INSTANCES);
  if (isNaN(MaxInstances) || MaxInstances <= 0) {
    console.log(Tags.error + chalk.red("Invalid value for MAX_INSTANCES, defaulting to 2."));
    MaxInstances = 2;
  }
}

setTimeout(
  async () => {
    CleanUps();
    await processRobustFiles();
    init();
  },
  Debug ? 0 : 15000
);

function CleanUps() {
  if (fs.existsSync(path.join(__dirname, "POIRenders")))
    fs.rmSync(path.join(__dirname, "POIRenders"), { recursive: true, force: true });

  if (fs.existsSync(path.join(__dirname, "POIData.json")))
    fs.rmSync(path.join(__dirname, "POIData.json"), { recursive: true, force: true });

  if (fs.existsSync(path.join(__dirname, "poi_statistic.json")))
    fs.rmSync(path.join(__dirname, "poi_statistic.json"), { recursive: true, force: true });

  if (!fs.existsSync(path.join(__dirname, "POIRenders")))
    fs.mkdirSync(path.join(__dirname, "POIRenders"), { recursive: true });
    
  // Создаем серверную директорию для рендеров
  try {
    fs.mkdirSync(WEB_RENDERS_DIR, { recursive: true });
    console.log(Tags.info + chalk.green(`Server render directory created: ${WEB_RENDERS_DIR}`));
  } catch (error) {
    console.log(Tags.warning + chalk.yellow(`Could not create server render directory: ${error.message}`));
  }
}

async function init() {
  let POIFiles = await FindPOIFiles(POIPrototypePath);
  const AllPOIToRender = [];
  const POIData = [];

  POIFiles.forEach((file) => {
    if (String(file).toLowerCase().includes("base")) return; // Skip base.yml
    let fileName = String(file).split("/").pop().toLowerCase();
    if (DevFilter.length !== 0 && !DevFilter.includes(String(fileName.replace(".yml", "")))) {
      if (Debug) console.log(Tags.debug + chalk.cyan(`Ignoring POI File: ${file}`));
      return;
    }; // Only for testing purposes
    if (Debug) console.log(Tags.debug + chalk.cyan(`Found POI File: ${file}`));
    
    const filePath = path.join(POIPrototypePath, file);
    const fileContent = fs.readFileSync(filePath, "utf8");
    const yamlData = YAML.parse(fileContent, { logLevel: "error" });
    
    // Найдем первый pointOfInterest в файле (не abstract)
    const poiEntry = yamlData.find(entry => entry.type === "pointOfInterest" && !entry.abstract);
    if (!poiEntry) return;
    
    // Создаем запись для JSON
    const poiJsonEntry = {
      id: poiEntry.id,
      name: poiEntry.name,
      file_path: `Resources/Prototypes/_NF/PointsOfInterest/${file}`
    };
    
    POIData.push(poiJsonEntry);
    
    // Найдем соответствующий файл карты
    const mapFile = findMapFileForPOI(poiEntry);
    if (mapFile) {
      AllPOIToRender.push({
        prototypeFile: file,
        mapFile: mapFile,
        id: poiEntry.id,
        name: poiEntry.name
      });
      
      const relativePath = path.relative(__dirname, path.join(POIMapPath, mapFile)).replace(/\\/g, "/");
      POIPaths[poiEntry.id.toLowerCase()] = relativePath;
    } else {
      console.log(Tags.warning + chalk.yellow(`Map file not found for POI: ${poiEntry.id}`));
    }
  });

  // Добавляем Frontier Outpost вручную из отдельной папки
  const frontierPath = path.join(__dirname, "..", "..", "..", "Resources", "Prototypes", "_NF", "Maps", "Outpost", "frontier.yml");
  if (fs.existsSync(frontierPath)) {
    POIData.push({
      id: "Frontier",
      name: "Frontier Outpost",
      file_path: "Resources/Prototypes/_NF/Maps/Outpost/frontier.yml"
    });
    
    const frontierMapPath = "frontier.yml";
    const frontierMapFullPath = path.join(__dirname, "..", "..", "..", "Resources", "Maps", "_NF", "Outpost", frontierMapPath);
    if (fs.existsSync(frontierMapFullPath)) {
      AllPOIToRender.push({
        prototypeFile: "frontier.yml",
        mapFile: frontierMapPath,
        id: "Frontier",
        name: "Frontier Outpost",
        isOutpost: true  // Флаг что это outpost, а не POI
      });
      
      const relativePath = path.relative(__dirname, frontierMapFullPath).replace(/\\/g, "/");
      POIPaths["frontier"] = relativePath;
    }
  }

  if (AllPOIToRender.length === 0) {
    console.log(Tags.error + chalk.red(`No POI maps were found, exiting...`));
    return process.exit(1);
  }

  // Сохраняем POIData.json локально для отладки
  fs.writeFileSync(path.join(__dirname, "POIData.json"), JSON.stringify(POIData, null, 2), "utf8");
  
  // Сохраняем на сервер
  try {
    // Убеждаемся, что директория существует
    const serverDir = path.dirname(WEB_POI_JSON);
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(WEB_POI_JSON, JSON.stringify(POIData, null, 4), "utf8");
    console.log(Tags.info + chalk.green(`POI data saved to server: ${WEB_POI_JSON}`));
  } catch (error) {
    console.log(Tags.error + chalk.red(`Failed to save POI data to server: ${error.message}`));
  }

  let IsMapRendererBuilt = false;

  if (!SkipBuild) {
    console.log(chalk.yellow("Building MapRenderer..."));
    const BuildMapRenderer = exec(`cd ${Root} && dotnet build Content.MapRenderer/Content.MapRenderer.csproj`);
    AddExecLogs(BuildMapRenderer, "[MapRenderer]");
    BuildMapRenderer.on("close", () => {
      IsMapRendererBuilt = true;
      console.log(chalk.green("MapRenderer built successfully!"));
      console.log(chalk.yellow("Starting POI MapRenderer..."));
    });
  } else IsMapRendererBuilt = true;

  let CurrentInstances = 0;

  const Queue = setInterval(() => {
    if (!IsMapRendererBuilt) {
      if (Debug) console.log(Tags.debug + chalk.cyan("MapRenderer is not built yet, waiting..."));
      return;
    }
    if (AllPOIToRender.length === 0 && CurrentInstances === 0) {
      if (LockQueueClear) return console.log(Tags.warning + chalk.yellow("Another Action is requiring a QueueLock, waiting for Action to end."));
      clearInterval(Queue);
      console.log(Tags.info + chalk.green("All POI have been rendered, Exiting..."));
      fs.writeFileSync(path.join(__dirname, "poi_statistic.json"), JSON.stringify({ succeed: SucceedPOIs, edited: EditedPOIs, failed: FailedPOIs }, null, 2), "utf8");
      return;
    }
    if (CurrentInstances < MaxInstances) {
      if (AllPOIToRender.length === 0) {
        if (Debug) console.log(Tags.debug + chalk.cyan("No POI left to start rendering or last POI are still rendering..."));
        return;
      }
             let NextPOI = AllPOIToRender.shift();
       console.log(chalk.blue(`Starting MapRenderer for ${NextPOI.isOutpost ? 'Outpost' : 'POI'} ${NextPOI.name} (${NextPOI.id}), Taking ${PrettyPrintNumber(CurrentInstances + 1)} Slot, now at ${CurrentInstances + 1}/${MaxInstances} Instances, ${AllPOIToRender.length} left to render`));
       
       // Добавляем префикс Maps/_NF/POI/ или Maps/_NF/Outpost/ к пути файла для MapRenderer
       const mapPath = NextPOI.isOutpost ? `Maps/_NF/Outpost/${NextPOI.mapFile}` : `Maps/_NF/POI/${NextPOI.mapFile}`;
       // Используем серверную директорию для рендеров, создаем локальную папку как fallback
       const outputDir = fs.existsSync(path.dirname(WEB_RENDERS_DIR)) ? WEB_RENDERS_DIR : path.join(__dirname, "POIRenders");
       const Command = `cd ${Root} && dotnet run --project Content.MapRenderer --files ${mapPath} --output ${outputDir}`;
      
      if (Debug)
        console.log(Tags.debug + chalk.cyan(`[${CurrentInstances + 1}-Render] Running ChildExec Command: ${Command}`));
      const RenderPOI = exec(Command);
      AddExecLogs(RenderPOI, `[#${CurrentInstances + 1}-Renderer-${NextPOI.id}]`, NextPOI.id);
      CurrentInstances++;
      RenderPOI.on("close", () => {
        if (Debug) console.log(Tags.debug + chalk.cyan(`Instance ${NextPOI.id} has finished, deducting one Instance. Now: ${CurrentInstances}/${MaxInstances} Instances`));
                 CurrentInstances--;
         if (!FailedPOIs.includes(NextPOI.id)) { 
           console.log(Tags.info + chalk.green(`Finished MapRenderer for ${NextPOI.isOutpost ? 'Outpost' : 'POI'} ${NextPOI.name} (${NextPOI.id})`));
         } else {
           console.log(Tags.error + chalk.red(`MapRenderer failed for ${NextPOI.isOutpost ? 'Outpost' : 'POI'} ${NextPOI.name} (${NextPOI.id})`));
         }
      });
    } else {
      if (Debug) console.log(Tags.debug + chalk.cyan(`Max instances reached, waiting for next slot. (${CurrentInstances}/${MaxInstances})`));
    }
  }, 5000);
}

function findMapFileForPOI(poiEntry) {
  // Пытаемся найти gridPath в POI записи
  if (poiEntry.gridPath) {
    // Извлекаем имя файла из gridPath (например, /Maps/_NF/POI/nfsd.yml -> nfsd.yml)
    const mapFileName = poiEntry.gridPath.split("/").pop();
    
    // Проверяем существование файла
    const mapFilePath = path.join(POIMapPath, mapFileName);
    if (fs.existsSync(mapFilePath)) {
      return mapFileName;
    }
  }
  
  // Если gridPath не найден или файл не существует, пытаемся найти по ID
  const possibleNames = [
    `${poiEntry.id.toLowerCase()}.yml`,
    `${poiEntry.name.toLowerCase().replace(/\s+/g, "").replace(/'/g, "")}.yml`,
  ];
  
  for (const possibleName of possibleNames) {
    const mapFilePath = path.join(POIMapPath, possibleName);
    if (fs.existsSync(mapFilePath)) {
      return possibleName;
    }
  }
  
  // Специальные случаи для известных расхождений
  const specialMappings = {
    "Bahama": "bahama.yml",
    "CaseysCasino": "caseyscasino.yml",
    "Tinnia": "tinnia.yml",
    "CargoDepot": "cargodepot.yml",
    "CargoDepotAlt": "cargodepotalt.yml",
    "Nfsd": "nfsd.yml",
    "LPBravo": "lpbravo.yml",
    "Medical": "medical.yml",
    "McHobo": "mchobo.yml",
    "ThePit": "thepit.yml",
    "Courthouse": "courthouse.yml",
    "TradeMall": "trademall.yml",
    "BarrierGate": "barriergate.yml",
    "Edison": "edison.yml",
    "AnomalousGeode": "anomalousgeode.yml",
    "Lodge": "lodge.yml",
    "Cove": "cove.yml",
    "Grifty": "grifty.yml"
  };
  
  if (specialMappings[poiEntry.id]) {
    const mapFilePath = path.join(POIMapPath, specialMappings[poiEntry.id]);
    if (fs.existsSync(mapFilePath)) {
      return specialMappings[poiEntry.id];
    }
  }
  
  return null;
}

async function FindPOIFiles(folderPath, poiFiles = [], rootFolder = folderPath) {
  const contents = fs.readdirSync(folderPath);

  for (const file of contents) {
    const filePath = path.join(folderPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      await FindPOIFiles(filePath, poiFiles, rootFolder);
    } else {
      const relativePath = path.relative(rootFolder, filePath).replace(/\\/g, "/"); // Normalize to forward slashes
      poiFiles.push(relativePath);
    }
  }

  return poiFiles;
}

let ErrorTiggers = [
  "System.ArgumentException",
  "[ERRO]"
]

function AddExecLogs(exec, prefix = null, poiId = null) {
  if (!ShowContainerLogs) return;

  function logData(data) {
    data = data.toString().trim();
    if (!data) return;
    if (!Logs[poiId]) Logs[poiId] = [];
    Logs[poiId].push(data);

    let color = "gray";
    if (ErrorTiggers.some((trigger) => data.includes(trigger))) {
      color = "bgRed";
      prefix = Tags.error + (prefix || "");
      if (poiId && !FailedPOIs.includes(poiId)) {
        FailedPOIs.push(poiId);
      }
    }

    console.log(chalk[color](`${prefix ? `${prefix} ` : ""}${data}`));
  }

  exec.stdout.on("data", logData);
  exec.stderr.on("data", logData);

  exec.on("close", (code) => {
    const color = "gray";
    console.log(chalk[color](`${prefix ? `${prefix} ` : ""}child process exited with code ${code}`));
    if (!FailedPOIs.includes(poiId) && poiId) {
      SucceedPOIs.push(poiId);
      RenameMappedFile(poiId);
      delete Logs[poiId];
    }
  });
}

function RenameMappedFile(poiId) {
  // Определяем базовую директорию для поиска рендеров
  const baseRenderDir = fs.existsSync(path.dirname(WEB_RENDERS_DIR)) ? WEB_RENDERS_DIR : path.join(__dirname, "POIRenders");
  
  let POIPath = path.join(baseRenderDir, String(poiId).toLowerCase());
  let POIFile = path.join(POIPath, `${String(poiId).toLowerCase()}-0.png`);
  
  if (fs.existsSync(POIFile)) {
    console.log(Tags.info + chalk.green(`Found rendered POI file: ${POIFile}`));
  } else {
    // The Linux version seem to uppercase the first letter of the POI name
    POIPath = path.join(baseRenderDir, String(poiId).toLowerCase().replace(/^./, str => str.toUpperCase()));
    POIFile = path.join(POIPath, `${String(poiId).toLowerCase().replace(/^./, str => str.toUpperCase())}-0.png`);
    if (fs.existsSync(POIFile)) {
      console.log(Tags.info + chalk.green(`Found rendered POI file: ${POIFile}`));
    } else {
      // Scan the folder for the rendered file
      if (fs.existsSync(POIPath)) {
        const files = fs.readdirSync(POIPath);
        const fileToRename = files.find(file => file.includes(poiId) && file.endsWith(".png"));
        if (fileToRename) {
          const foundPath = path.join(POIPath, fileToRename);
          console.log(Tags.info + chalk.green(`Found rendered POI file: ${foundPath}`));
        } else {
          console.log(Tags.error + chalk.red(`Failed to find the rendered file for POI ${poiId}`));
        }
      } else {
        console.log(Tags.error + chalk.red(`Render directory not found: ${POIPath}`));
      }
    }
  }
}

function PrettyPrintNumber(number) {
  if (number === 1) return `${number}st`;
  if (number === 2) return `${number}nd`;
  if (number === 3) return `${number}rd`;
  return `${number}th`;
} 