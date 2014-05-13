var fs = require('fs');
var cluster = require('cluster');

var redis = require('redis');

////simplewallet --wallet-file=wallet.bin --pass=test --rpc-bind-port=8082


//./simplewallet --wallet-file=wallet.bin --pass=test --rpc-bind-port=8342 --daemon-port=32837


if (cluster.isWorker){
    switch(process.env.workerType){
        case 'pool':
            require('./pool.js');
            break;
        case 'paymentProcessor':
            require('./paymentProcessor.js');
            break;
        case 'api':
            require('./api.js');
            break;
        case 'cli':
            require('./cli.js');
            break
    }
    return;
}

var config = JSON.parse(fs.readFileSync('config.json'));

var logger = require('./logUtil.js')({
    logLevel: config.logLevel,
    logColors: config.logColors
});

var logSystem = 'Master';
var logSubsystem = null;

var os = require('os');

(function init(){
    checkRedisVersion(function(){
        spawnPoolWorkers();
        spawnPaymentProcessor();
        spawnApi();
        spawnCli();
    });
})();


function checkRedisVersion(callback){
    var redisClient = redis.createClient(config.redis.port, config.redis.host);
    redisClient.info(function(error, response){
        if (error){
            logger.error(logSystem, logComponent, logSubCat, 'Redis version check failed');
            return;
        }
        var parts = response.split('\r\n');
        var version;
        var versionString;
        for (var i = 0; i < parts.length; i++){
            if (parts[i].indexOf(':') !== -1){
                var valParts = parts[i].split(':');
                if (valParts[0] === 'redis_version'){
                    versionString = valParts[1];
                    version = parseFloat(versionString);
                    break;
                }
            }
        }
        if (!version){
            logger.error(logSystem, logSubsystem, null, 'Could not detect redis version - but be super old or broken');
            return;
        }
        else if (version < 2.6){
            logger.error(logSystem, logSubsystem, null, "You're using redis version " + versionString + " the minimum required version is 2.6. Follow the damn usage instructions...");
            return;
        }
        callback();
    });
}

function spawnPoolWorkers(){

    var numForks = (function(){
        if (!config.clusterForks)
            return 1;
        if (config.clusterForks === 'auto')
            return os.cpus().length;
        if (isNaN(config.clusterForks))
            return 1;
        return config.clusterForks;
    })();

    var poolWorkers = {};

    var createPoolWorker = function(forkId){
        var worker = cluster.fork({
            workerType: 'pool',
            forkId: forkId
        });
        worker.forkId = forkId;
        worker.type = 'pool';
        poolWorkers[forkId] = worker;
        worker.on('exit', function(code, signal){
            //severity, system, subsystem, component, text
            logger.error(logSystem, logSubsystem, 'Pool Spawner', 'Fork ' + forkId + ' died, spawning replacement worker...');
            setTimeout(function(){
                createPoolWorker(forkId);
            }, 2000);
        }).on('message', function(msg){
            switch(msg.type){
                case 'none':
                    break;
            }
        });
    };

    var i = 0;
    var spawnInterval = setInterval(function(){
        createPoolWorker(i);
        i++;
        if (i === numForks){
            clearInterval(spawnInterval);
            logger.debug(logSystem, logSubsystem, 'Pool Spawner', 'Spawned pool on ' + numForks + ' thread(s)');
        }
    }, 10);
}

function spawnPaymentProcessor(){

    if (!config.payments || !config.payments.enabled) return;

    var worker = cluster.fork({
        workerType: 'paymentProcessor'
    });
    worker.on('exit', function(code, signal){
        logger.error(logSystem, logSubsystem, 'Payment Processor', 'Payment processor died, spawning replacement...');
        setTimeout(function(){
            spawnPaymentProcessor();
        }, 2000);
    });
}

function spawnApi(){

}

function spawnCli(){

}