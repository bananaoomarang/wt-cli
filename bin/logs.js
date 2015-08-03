var Bluebird = require('bluebird');
var Boom = require('boom');
var Bunyan = require('bunyan');
var Cli = require('nested-yargs');
var Colors = require('colors');
var PrettyStream = require('bunyan-prettystream');
var Webtask = require('../');
var _ = require('lodash');

module.exports = Cli.createCommand('logs', 'Streaming, real-time logs', {
    params: '[container]',
    options: {
        raw: {
            alias: 'r',
            description: 'do not pretty print',
            type: 'boolean',
        },
        all: {
            alias: 'a',
            description: 'show cluster logs',
            type: 'boolean',
        },
        verbose: {
            alias: 'v',
            description: 'show verbose logs',
            type: 'boolean',
        },
        profile: {
            alias: 'p',
            description: 'name of the webtask profile to use',
            'default': 'default',
            type: 'string',
        },
        httpBodies: {
            alias: 'b',
            description: 'show request and response bodies',
            'default': true,
            type: 'boolean'
        }
    },
    handler: handleStream,
});

  
function handleStream (argv) {
    var prettyStdOut = new PrettyStream({ mode: 'short' });
    var logger = Bunyan.createLogger({
          name: 'wt',
          streams: [{
              level: 'debug',
              type: 'raw',
              stream: prettyStdOut
          }]
    });    

    prettyStdOut.pipe(process.stdout);
    
    var isRequestLog = /^.+\s(?:GET|PUT|POST|PATCH|DELETE)\s.+\d{3}\s.+$/;
    var container = argv.params.container;
    
    if (container) {
        argv.container = container;
    }
    
    var config = Webtask.configFile();
    
    config.load()
        .then(function (profiles) {
            if (_.isEmpty(profiles)) {
                throw new Error('You must create a profile to begin using '
                    + 'this tool: `wt init`.');
            }
            
            return config.getProfile(argv.profile);
        })
        .then(function (profile) {
            return Bluebird.all([
                profile,
                profile.createLogStream(argv)
            ]);
        })
        .spread(function (profile, stream) {
            logger.info({ container: argv.container || profile.container },
                'connected to streaming logs');

            setTimeout(function () {
                logger.warn('reached maximum connection time of 30min, '
                    +'disconnecting');
                process.exit(1);
            }, 30 * 60 * 1000).unref();
            
            stream.on('data', function (event) {
                if (event.type === 'data') {
                    try {
                        var data = JSON.parse(event.data);
                    } catch (__) { return; }
                    
                    if (!data || (data.name !== 'sandbox-kafka' && !argv.all))
                        return;

                    if (argv.raw) console.log(data.msg);
                    else if (isRequestLog.test(data.msg)) logRequest(data.msg);
                    else if (typeof data === 'string') logger.info(data.msg);
                    else if (argv.verbose) logger.info(data, data.msg);
                    else logger.info(data.msg);
                }
            });
        })
        .catch(logError);

        function logRequest(str) {
            var split = str.split(' ');

            var method = split[1];
            var url    = split[2];
            var code   = Number(split[3]);
            var bodies = split.slice(4).join(' ');

            var msg = '';

            msg += '['.bold + method.bold;
            msg += (new Array(7 - method.length)).join(' '); // padding to align codes
            msg += code.toString().bold + ' ';
            msg += url + ']'.bold;

            if(code >= 200 && code < 300)
                msg = msg.green;
            else if(code >= 300 && code < 400)
                msg = msg.blue;
            else if(code >= 400)
                msg = msg.red;

            if(argv.httpBodies && bodies)
                msg += ' ' + bodies.yellow;

            logger.info(msg);
        }
}

function logError (e) {
    console.error(e);
    console.log(e.message.red);
    if (e.trace) console.log(e.trace);
    process.exit(1);
}

