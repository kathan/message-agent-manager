/*
message-agent-manager
*/
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
  var ip = os.networkInterfaces().en0[1].address;
  var hostname;
  var config_file_name = options.config_file_name || 'fam-cfg.json';
  var port = options.port || 8080;
  var wf_url;// = Url.resolve(`http://${hostname}:${port}`, 'workflows');
  var app;
  var workflows = [];
  EventEmitter.call(this);
  function getHostname(cb){
    dns.reverse(ip, (err, hostnames)=>{
      //if(err){return cb(err);}
      hostname = hostnames[0] || ip;
      log('hostname', hostname);
      wf_url = Url.resolve(`http://${hostname}:${port}`, 'workflows');
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
      if(data){
        var json = JSON.parse(data);
        if(json.workflows){
          createWorkflows(json.workflows, ()=>{
            cb();
          });
        }
        return;
      }
      cb();
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
  
  this.createWorkflow = function(opts, cb){
    var w = self.getWorkflow(opts.name);
    //log('existing workflow', w)
    if(!w){
      log(`Creating workflow ${opts.name}`);
      var wf = MessageAgentWorkflow(app, {
        name: opts.name,
        running: opts.running || false,
        url: Url.resolve(wf_url, opts.name),
        directory: path.resolve(wf_dir, opts.name),
        agents: opts.agents || [],
        log: opts.log || log,
        error: opts.error || error
      }, (err)=>{
        cb(err);
      });
      workflows.push(wf);
    }else{
      cb(`A workflow named ${opts.name} already exists.`);
    }
  };
  
  function createServer(cb){
    app = express();
    
    app.set("json spaces", 2);
    app.use((req, res, next)=>{
      if (req.method.toLowerCase() == 'post') {
        var form = new formidable.IncomingForm();
        //console.log('Server received post. Parsing files...');
        form.parse(req, function(err, fields, files) {
          if(err){return;}
          req.body = fields;
          //req.files = files;

          for(var i in files){
            files[i].data = fs.readFileSync(files[i].path);
          }
          req.files = files;
          //console.log('Files parsed.');
          next();
        });
        return;
      }
      next();
    });
    
    app.get('/', (req, res, next)=>{
      res.json({workflows:workflows});  
    });
    
    app.get('/workflows', (req, res, next)=>{
      res.json(workflows);  
    });

    app.post(`/workflows`, (req, res, next) => {
      //log('POST workflow id', id);
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

    /*app.get(`/${name}/:id`, function (req, res, next, id) {
      self.getWorkflow(id)
      next();
    });*/
    
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
module.exports = MessageAgentManager;