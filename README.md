# Physio Therapy Guidance System
A detailed overview of "how do they plan to pull this off?"


### algorithm overview kinda 

Process video at 30 FPS(because 60fpps is too compute heavy and the person waiting to upload will get frustrated and sue us or something): for each frame, seek to timestamp, run pose detection (33 landmarks), smooth with One Euro Filter, compute joint angles:  
3-point angles: angle at a joint from 3 connected points (like hip-knee-ankle)  
2-point segment angles: angle of limb relative to vertical (as in knee-ankle relative to the true y axis)  
Group angles by timestamp into frame vectors for clustering.  
Apply K-Means clustering (2–4 clusters):  
Initialize random centroids  
Assign frames to nearest centroid (Euclidean distance)  
Recompute centroid as mean of assigned frames  
Repeat until stable → identifies distinct exercise states ("Bent," "Extended," "Intermediate")  
Detect state occurrences: group consecutive frames in same cluster into temporal windows, store start, end, duration.  
Count repetitions: traverse state sequence, count a rep only when moving from start (bent) → peak (extended) → back to start.  
Create exercise template: states, transitions between states, ordered state sequence, total duration, recommended reps, metadata (FPS, confidence).  
Upload comparison video: generate object URL, analyze like reference video.  

Compare templates:  
State matching: find closest uploaded state for each reference state  
Angle deviation: average difference between angles  
Overall similarity: weighted combination of state match (60%) + angle accuracy (40%)  
Display results: color-coded similarity score, rep counts, state accuracy bars, angle deviation cards.  


### things lacking:
- a dashboard  
- login/signin  
- designing db  
- connecting db 
- configuring db operations  
- performing the exercise in realtime while doing all the calculations + inferences then converting them into useful text to nudge the patient, routing that to an external voice api and speaking the words all in less than 90 ms (amen)  
# ExerAid
