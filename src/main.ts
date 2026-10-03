import './ui/styles.css';
import { localStore } from './storage';
import { mountApp } from './ui/app';

mountApp(document.getElementById('app')!, localStore);
