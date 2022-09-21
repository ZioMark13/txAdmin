import fs from 'node:fs';
import path from 'node:path';
import slash from 'slash';

import logger from '@core/extras/console';
import { txEnv } from '@core/globalData.ts';

import { printBanner } from '@core/extras/banner';
import setupProfile from '@core/extras/setupProfile';
import updateChecker from '@core/extras/updateChecker';

import AdminVault from '@core/components/AdminVault';
import ConfigVault from '@core/components/ConfigVault';
import DiscordBot from '@core/components/DiscordBot';
import DynamicAds from '@core/components/DynamicAds';
import FxRunner from '@core/components/FxRunner';
import Logger from '@core/components/Logger';
import HealthMonitor from '@core/components/HealthMonitor';
import Scheduler from '@core/components/Scheduler';
import PlayerController from '@core/components/PlayerController';
import StatsCollector from '@core/components/StatsCollector';
import Translator from '@core/components/Translator';
import WebServer from '@core/components/WebServer';
import ResourcesManager from '@core/components/ResourcesManager';
import PlayerlistManager from '@core/components/PlayerlistManager';
import PlayerDatabase from '@core/components/PlayerDatabase';

const { dir, log, logOk, logWarn, logError } = logger(`v${txEnv.txAdminVersion}`);


//Helpers
const cleanPath = (x) => { return slash(path.normalize(x)); };


// Long ago I wanted to replace this with dependency injection.
// I Totally gave up.
global.globals = {
    adminVault: null,
    discordBot: null,
    fxRunner: null,
    logger: null,
    dynamicAds: null,
    healthMonitor: null,
    scheduler: null,
    statsCollector: null,
    translator: null,
    webServer: null,
    playerController: null,
    resourcesManager: null,
    playerlistManager: null,
    playerDatabase: null,
    config: null,
    deployer: null,
    info: {},

    //NOTE: still not ideal, but since the extensions system changed entirely,
    //      will have to rethink the plans for this variable.
    databus: {
        //internal
        resourcesList: null,
        updateChecker: null,
        joinCheckHistory: [],

        //stats
        txStatsData: {
            playerDBStats: null,
            lastFD3Error: '',
            monitorStats: {
                heartBeatStats: {
                    httpFailed: 0,
                    fd3Failed: 0,
                },
                restartReasons: {
                    close: 0,
                    heartBeat: 0,
                    healthCheck: 0,
                },
                bootSeconds: [],
                freezeSeconds: [],
            },
            randIDFailures: 0,
            pageViews: {},
            httpCounter: {
                current: 0,
                max: 0,
                log: [],
            },
            login: {
                origins: {
                    localhost: 0,
                    cfxre: 0,
                    ip: 0,
                    other: 0,
                    webpipe: 0,
                },
                methods: {
                    discord: 0,
                    citizenfx: 0,
                    password: 0,
                    zap: 0,
                    nui: 0,
                    iframe: 0,
                },
            },
        },
    },
};


/**
 * Main APP
 */
export default class TxAdmin {
    adminVault;
    discordBot;
    logger;
    translator;
    fxRunner;
    dynamicAds;
    healthMonitor;
    scheduler;
    statsCollector;
    webServer;
    playerController;
    resourcesManager;
    playerlistManager;
    playerDatabase;

    constructor(serverProfile) {
        log(`Profile '${serverProfile}' starting...`);
        globals.info.serverProfile = serverProfile;

        //Check if the profile exists and call setup if it doesn't
        const profilePath = cleanPath(path.join(txEnv.dataPath, serverProfile));
        if (!fs.existsSync(profilePath)) {
            try {
                setupProfile(txEnv.osType, txEnv.fxServerPath, txEnv.fxServerVersion, serverProfile, profilePath);
            } catch (error) {
                logError(`Failed to create profile '${serverProfile}' with error: ${error.message}`);
                process.exit();
            }
        }
        globals.info.serverProfilePath = profilePath;

        //Load Config Vault
        let profileConfig;
        try {
            globals.configVault = new ConfigVault(profilePath, serverProfile);
            profileConfig = globals.configVault.getAll();
            globals.config = profileConfig.global;
        } catch (error) {
            logError(`Error starting ConfigVault: ${error.message}`);
            dir(error);
            process.exit(1);
        }

        //Start all modules
        //NOTE: dependency order
        //  - translator before healthMonitor (TODO: check if still necessary)
        //  - adminVault before webserver
        //  - logger before fxrunner
        //  - translator before fxrunner (for the locale string)
        try {
            this.adminVault = new AdminVault();
            this.discordBot = new DiscordBot(profileConfig.discordBot);
            this.logger = new Logger(profileConfig.logger);
            this.translator = new Translator();
            this.fxRunner = new FxRunner(profileConfig.fxRunner);
            this.dynamicAds = new DynamicAds(profileConfig.dynamicAds);
            this.healthMonitor = new HealthMonitor(profileConfig.monitor);
            this.scheduler = new Scheduler(profileConfig.monitor); //NOTE same opts as monitor, for now
            this.statsCollector = new StatsCollector(profileConfig.statsCollector);
            this.webServer = new WebServer(profileConfig.webServer);
            this.playerController = new PlayerController(profileConfig.playerController);
            this.resourcesManager = new ResourcesManager(profileConfig.resourcesManager);
            this.playerlistManager = new PlayerlistManager(this, profileConfig.playerController);
            this.playerDatabase = new PlayerDatabase(this, profileConfig.playerController);

            //After the migration, delete this.
            globals.adminVault = this.adminVault;
            globals.discordBot = this.discordBot;
            globals.logger = this.logger;
            globals.translator = this.translator;
            globals.fxRunner = this.fxRunner;
            globals.dynamicAds = this.dynamicAds;
            globals.healthMonitor = this.healthMonitor;
            globals.scheduler = this.scheduler;
            globals.statsCollector = this.statsCollector;
            globals.webServer = this.webServer;
            globals.playerController = this.playerController;
            globals.resourcesManager = this.resourcesManager;
            globals.playerlistManager = this.playerlistManager;
            globals.playerDatabase = this.playerDatabase;
        } catch (error) {
            logError(`Error starting main components: ${error.message}`);
            dir(error);
            process.exit(1);
        }

        //Once they all finish loading, the function below will print the banner
        printBanner();

        //Run Update Checker every 15 minutes
        updateChecker();
        setInterval(updateChecker, 15 * 60 * 1000);
    }
};
