fetch('/api/lineas-team/set-all-lines-pending', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => {
  console.log('Resultado:', data);
})
.catch(error => {
  console.error('Error:', error);
});
