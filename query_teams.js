// Query to get teams and their agents
db.costumers.aggregate([
  { 
    $match: { 
      supervisor: { $ne: null, $ne: '' } 
    } 
  }, 
  { 
    $group: { 
      _id: '$supervisor', 
      agents: { $addToSet: '$agente' }, 
      count: { $sum: 1 } 
    } 
  }, 
  { 
    $sort: { count: -1 } 
  }
]).forEach(printjson);
