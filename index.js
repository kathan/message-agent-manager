/*******************************************
* message-agent-manager
* Copyright (c) 2018, Darrel Kathan 
* Licensed under the MIT license.
*
* A current version and documentation is available at
*    https://github.com/kathan/message-agent-manager
*
* @summary     message-agent-manager
* @description message-agent-manager A Javascript module that for transferring messages over HTTP.
* @file        message-agent-manager
* @version     0.0.1
* @author      Darrel Kathan
* @license     MIT
*******************************************/
const EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const os = require('os');
const dns = require('dns');
const path = require('path');
const Url = require('url');
const util = require('util');

const MessageAgentWorkflow = require('./workflow.js');

//==== Dependencies ====
const Async = require('async');
const formidable = require('formidable');
const bodyParser = require('body-parser');
const express = require('express');

var MessageAgentManager = function(options, callback){
  if ( !(this instanceof MessageAgentManager) ){
    return new MessageAgentManager(options, callback);
  }
  var self = this;
  var log = options.log || function(){
    var d = new Date();
    const args = Array.from(arguments);
    
    args.unshift(self.constructor.name);
    args.unshift(`${d}`);
    
    console.log.apply(this, args);
  };
  var error = options.error || function (){
    const args = Array.from(arguments);
    args.unshift('ERROR:');
    var e = new Error();
    args.push(e.stack);
    log.apply(null, args);
  };
  var log_dir = options.log_dir || 'logs';
  var wf_dir = options.wf_dir || 'workflows';
  //log(os.networkInterfaces());
  var ip = getIp();
  var hostname;
  var config_file_name = options.config_file_name || 'fam-cfg.json';
  var port = options.port || 8080;
  var workflows_url;// = Url.resolve(`http://${hostname}:${port}`, 'workflows');
  var app;
  var workflows = [];
  EventEmitter.call(this);
  function getIp(){
  	var intf = os.networkInterfaces();
  	for(var i in intf){
		var adds = intf[i];
		for(var a in adds){
			var add = adds[a];
			
			if(!add.internal && add.family === 'IPv4'){
				return add.address;
			}
		}
	}
  }
  function getHostname(cb){
    dns.reverse(ip, (err, hostnames)=>{
      //if(err){return cb(err);}
      hostname = hostnames[0] || ip;
      log('hostname', hostname);
      workflows_url = Url.resolve(`http://${hostname}:${port}`, 'workflows');
      cb();
    });
  }
  this.getWorkflows = function(){
    return workflows;
  };
  
  function loadConfig(cb){
    fs.readFile(path.resolve(__dirname, config_file_name), (err, data)=>{
      if(err){
        if(err.code !== 'ENOENT'){
          error(err);
          return cb(err);
        }
      }
      //if(data){
        var json = JSON.parse(data);
        if(json.workflows){
          createWorkflows(json.workflows, ()=>{
            cb();
          });
        }
        //return;
      //}
      //cb();
    });
  }
  
  function storeConfig(cb){
    fs.writeFileSync(path.resolve(__dirname, config_file_name), JSON.stringify({workflows:workflows}));
  }
  
  function createWorkflows(wrkflws, cb){
    Async.forEach(wrkflws, 
      (workflow, next)=>{
        self.createWorkflow(workflow, (err)=>{
          if(err){return next(err);}
          next();
        });
      },
      (err)=>{
        if(err){return cb(err);}
        cb();
      }
    );
  }
  
  this.getWorkflow = function(name){
    return workflows.find((workflow)=>{
      return workflow.name === name;
    });
  };
  //var cb_count=0;
  this.createWorkflow = function(opts, cb){
    var w = self.getWorkflow(opts.name);
    //log('existing workflow', w)
    if(!w){
      log(`Creating workflow ${opts.name}`);
      var new_url = Url.resolve(workflows_url, opts.name);
      //log('new_url', new_url);
      var wf = MessageAgentWorkflow(app, {
        name: opts.name,
        //running: opts.running || false,
        url: new_url,
        //url: wf_url,
        directory: path.resolve(wf_dir, opts.name),
        agents: opts.agents || [],
        log: opts.log || log,
        error: opts.error || error
      }, (err)=>{
        //log('callback', ++cb_count);
        if(err){return cb(err);}
        cb();
      });
      workflows.push(wf);
    }else{
      cb(`A workflow named ${opts.name} already exists.`);
    }
  };
  
  function createServer(cb){
    app = express();
    
    app.set("json spaces", 2);
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());
    app.use((req, res, next)=>{
      //log('req.method', req.method, 'is multipart', req.is('multipart'));
      if (/*req.method.toLowerCase() === 'post' && */req.is('multipart') === 'multipart') {
        var form = new formidable.IncomingForm();
        form.maxFileSize = 200 * 1024 * 1024;
        //log('Server received post. Parsing files...');
        form.parse(req, (err, fields, files) => {
          if(err){return cb(err);}
          req.body = fields;
          req.files = files;
          next();
        });
        return;
      }
      next();
    });
    
    log(`GET manager at '/'`);
    app.get('/', (req, res, next)=>{
      res.json({workflows:workflows, modes: self.MODES});  
    });
    
    log(`GET workflows at '/workflows'`);
    app.get('/workflows', (req, res, next)=>{
      res.json(workflows);  
    });

    log(`Create new workflows at POST '/workflows' with "workflow" parameter`);
    app.post(`/workflows`, (req, res, next) => {
      log('POST workflow name', req.body.workflow);
      if(req.body.workflow){
        //var w = self.getWorkflow(req.body.workflow);
        //log('existing workflow', w);
        self.createWorkflow({name: req.body.workflow}, (err, wf)=>{
          res.json(wf);
          next();
        });
        return;
      }else{
        next();
      }
    });
    
    app.listen(port, () => {
      log(`listening on ${port}`);
      cb();
    });
  }
  
  process.on('SIGINT', () => {
    storeConfig();
    log('Quitting.');
    process.exit(0);
  });

  createServer((err)=>{
    if(err){error(err); return callback(err);}
    getHostname((err)=>{
      if(err){error(err); return callback(err);}
      loadConfig((err)=>{
        if(err){error(err); return callback(err);}
        log('running...');
        callback();
      });
    });
  });

};
util.inherits(MessageAgentManager, EventEmitter);
MessageAgentManager.prototype.MODES = MessageAgentWorkflow.MODES;
module.exports = MessageAgentManager;