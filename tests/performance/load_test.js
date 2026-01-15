import http from 'k6/http';
import { sleep, check } from 'k6';

// 1. Define test configuration (Options)
export const options = {
  vus: 100,           // 10 virtual users
  duration: '30s',   // Run for 30 seconds
};

// 2. Define the test logic
export default function () {
  const res = http.get('http://dino.mr-salih.org');
  
  // Verify the page loaded successfully
  check(res, {
    'is status 200': (r) => r.status === 200,
    'body contains welcome': (r) => r.body.includes("Dino"),
    'status is 200': (r) => r.status === 200,
  });

  sleep(1); // Simulate "think time" between requests 
}