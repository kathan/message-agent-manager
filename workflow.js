/*
message-agent-workflow
*/
const EventEmitter = require('events').EventEmitter;
const path = require('path');
const Url = require('url');
const util = require('util');

const Async = require('async');
const MessageAgent = require('message-agent');

var MessageAgentWorkflow = function(app, options, callback){
  if ( !(this instanceof MessageAgentWorkflow) ){
    return new MessageAgentWorkflow(app, options, callback);
  }
  var self = this;
  var cb_count=0;
  //var running = options.running || false;
  var agents = [];
  var agent_opts = options.agents || [];
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
  //log('agent_opts', agent_opts);
  var name = options.name;//required
  //==== Getters ====
  Object.assign(this,
    {
      get name() {
        return options.name;
      }
    }
  );
  var directory = options.directory; //required
  var url = options.url;
  var url_obj = Url.parse(url);
  //log('url_obj', url_obj);
  EventEmitter.call(this);
  this.toJSON = function (){
    return {
      name:name,
      url: url,
      directory:directory,
      agents:agents
    };
  };
  
  this.getAgent = function(name){
    return agents.find((agent)=>{
      return agent.name === name;
    });
  };
  
  this.createAgent = function(opts, cb){
    var a = self.getAgent(opts.name);
    //log('existing agent', a);
    if(!a){
      log(`Creating agent ${name}/${opts.name}`);
      var fa = MessageAgent(app, {
                          directory: directory,
                          name: opts.name,
                          //running: opts.running,
                          url: Url.resolve(url, `${name}/${opts.name}`),
                          dest: opts.dest || null
                          //log: log,
                          //error: error
                          }, (err)=>{
        log('callback', ++cb_count);
        if(err){return cb(err);}
        
        //log(`Running agent ${opts.agent_name}`);
        //fa.start();
        cb();
      });
      if(agent_opts.script && typeof agent_opts.script === 'function'){
        fa.on('file', agent_opts.script);
      }
      fa.on('error', (err)=>{
        error('Error', err);
      });
      
      agents.push(fa);
      return fa;
    }else{
      cb(`An agent named ${opts.name} already exists.`);
    }
  };
  
  function createAgents(cb){
    Async.forEach(agent_opts, 
      (agent, next)=>{
        self.createAgent(agent, (err)=>{
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
  
  app.get(`${url_obj.pathname}`, (req, res, next)=>{
    res.json(self);
    next();
  });
  
  /*app.put(`${url_obj.pathname}/start`, (req, res, next)=>{
    self.start();
    res.json({message:`Started ${name}`});
    next();
  });
    
  app.put(`${url_obj.pathname}/stop`, (req, res, next)=>{
    self.stop();
    res.json({message:`Stopped ${name}`});
    next();
  });*/
  
  app.post(`${url_obj.pathname}/agents`, (req, res, next)=>{
    if(req.body.agent){
      self.createAgent({
        name: req.body.agent
        //running: false
        }, (err, wf)=>{
        if(err){error(err);return res.json({error:err});}
        res.json(wf);
        next();
      });
      return;
    }else{
      next();
    }
    next();
  });

  createAgents((err)=>{
    if(err){
      error(err);
      if(typeof callback === 'function'){
        callback(err);
      }else{
        self.emit('error', err);
      }
      return
    }
    if(typeof callback === 'function'){
      setImmediate(callback);
    }else{
      self.emit('ready');
    }
  });
};

util.inherits(MessageAgentWorkflow, EventEmitter);
module.exports = MessageAgentWorkflow;